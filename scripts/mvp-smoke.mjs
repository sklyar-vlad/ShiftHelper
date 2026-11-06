import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.SMOKE_BASE_URL;
assert.ok(baseURL, "SMOKE_BASE_URL is required");
const browsers = await Promise.all([chromium.launch(), chromium.launch()]);
const pageErrors = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
const link = (page, name) => page.getByRole("link", { name, exact: true });
const visible = (page, text) => page.getByText(text, { exact: true }).waitFor();

async function session(index, mobile = false) {
  const context = await browsers[index].newContext({
    baseURL,
    viewport: { width: mobile ? 375 : 1280, height: 900 },
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}

async function post(page, path, data, status = 200) {
  const response = await page.request.post(`/api/v1${path}`, {
    headers: { Origin: baseURL },
    data,
  });
  assert.equal(response.status(), status, path);
  return response;
}

async function login(page, credentials) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await button(page, "Войти").click();
  await page.waitForURL(/\/(profile|my-gigs)(\?.*)?$/);
}

async function register(page, name, role) {
  const credentials = {
    email: `smoke-${randomBytes(8).toString("hex")}@example.test`,
    password: randomBytes(24).toString("hex"),
  };
  await page.goto("/register");
  await page
    .getByLabel(role === "customer" ? /Нужна помощь/ : /Ищу подработку/)
    .check();
  await page.getByLabel("Ваше имя", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await button(page, "Создать аккаунт").click();
  await page.waitForURL("**/profile");
  return credentials;
}

async function history(page, worker, title) {
  await page.goto(
    worker ? "/my-gigs?view=work&scope=history" : "/my-gigs?scope=history",
  );
  await link(page, title).waitFor();
  await visible(page, "Завершено");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
}

try {
  const customer = await session(0);
  const worker = await session(1, true);
  if (process.env.SMOKE_PHASE === "resume") {
    const state = JSON.parse(readFileSync("/state/result.json", "utf8"));
    for (const [page, credentials, isWorker] of [
      [customer, state.customer, false],
      [worker, state.worker, true],
    ]) {
      await login(page, credentials);
      await history(page, isWorker, state.title);
      const response = await page.request.get(`/api/v1/gigs/${state.gigId}`);
      assert.equal(response.status(), 200);
      const gig = await response.json();
      assert.equal(gig.status, "completed");
      assert.equal(gig.amountKopecks, 150050);
      assert.equal(gig.completedAt, state.completedAt);
      assert.equal(gig.submittedAt, state.submittedAt);
      assert.equal(gig.customer.ratingAverage, 4);
      assert.equal(gig.selectedWorker.ratingAverage, 5);
      await page.goto(`/gigs/${state.gigId}`);
      await visible(page, `Ваша оценка: ${isWorker ? 4 : 5} из 5`);
      assert.equal(
        await page
          .getByRole("form", { name: "Оценить вторую сторону" })
          .count(),
        0,
      );
    }
    console.log(
      "PASS: accounts, completed work and history survive service restart.",
    );
  } else {
    const guest = await session(0);
    await guest.goto("/my-gigs");
    await guest.waitForURL("**/login");
    await guest.goto("/catalog");
    await visible(guest, "Заданий пока нет");
    await guest.goto("/gigs/00000000-0000-4000-8000-000000000000");
    await visible(guest, "Задание недоступно");
    assert.equal((await guest.request.get("/api/v1/me")).status(), 401);
    assert.equal(
      (await guest.request.get("/api/v1/openapi.yaml")).status(),
      200,
    );
    await post(guest, "/gigs", {}, 401);
    const credentials = {
      customer: await register(customer, "Заказчик проверки", "customer"),
      worker: await register(worker, "Первый исполнитель", "worker"),
    };
    await customer.goto("/my-gigs");
    await visible(customer, "Заданий пока нет");
    await worker.goto("/my-gigs");
    await visible(worker, "Откликов пока нет");
    const second = await session(1);
    await register(second, "Второй исполнитель", "worker");
    const foreign = await session(0);
    await register(foreign, "Другой заказчик", "customer");

    const title = "Перенести коробки для показа";
    await customer.goto("/gigs/new");
    const date = (offset) =>
      new Date(Date.now() + offset).toISOString().slice(0, 16);
    for (const [label, value] of Object.entries({
      Название: title,
      Описание: "Помочь перенести коробки",
      Город: "Москва",
      Адрес: "Мира, 1",
      "Начало работы": date(86400000),
      "Окончание работы": date(90000000),
      "Сумма за всё задание, ₽": "1500,50",
    }))
      await customer.getByLabel(label, { exact: true }).fill(value);
    await button(customer, "Опубликовать").click();
    await customer.waitForURL(/\/gigs\/[0-9a-f-]+$/);
    const gigId = customer.url().split("/").at(-1);
    const path = `/gigs/${gigId}`;
    await post(worker, "/gigs", {}, 403);
    await post(foreign, `${path}/cancel`, undefined, 403);
    await worker.goto("/catalog");
    await worker.getByLabel("Название задания", { exact: true }).fill(title);
    await button(worker, "Найти").click();
    await link(worker, title).click();
    await worker
      .getByLabel("Комментарий (необязательно)", { exact: true })
      .fill("Готов помочь");
    await button(worker, "Откликнуться").click();
    await visible(worker, "Отклик ожидает решения заказчика.");
    await post(worker, `${path}/applications`, {}, 409);
    await post(customer, `${path}/applications`, {}, 403);
    await post(second, `${path}/applications`, {}, 201);
    await customer.reload();
    await customer
      .locator(".application-card")
      .filter({ hasText: "Первый исполнитель" })
      .getByRole("button", { name: "Выбрать исполнителя", exact: true })
      .click();
    await visible(customer, "В работе");
    assert.equal((await guest.request.get(`/api/v1${path}`)).status(), 404);
    assert.equal((await foreign.request.get(`/api/v1${path}`)).status(), 404);
    await post(customer, `${path}/cancel`, undefined, 409);
    await post(second, `${path}/submit`, undefined, 403);
    await post(customer, `${path}/submit`, undefined, 403);
    await post(customer, `${path}/confirm`, undefined, 409);
    await worker.reload();
    await button(worker, "Работа выполнена").click();
    await visible(worker, "Работа сдана. Ожидайте подтверждения заказчика.");
    await post(worker, `${path}/submit`, undefined, 409);
    await post(worker, `${path}/confirm`, undefined, 403);
    await customer.reload();
    await button(customer, "Подтвердить выполнение").click();
    await visible(customer, "Завершено");
    await post(customer, `${path}/confirm`, undefined, 409);
    for (const [page, score] of [
      [customer, 5],
      [worker, 4],
    ]) {
      await page.goto(path);
      await page
        .getByLabel("Оценка", { exact: true })
        .selectOption(String(score));
      await page
        .getByLabel("Отзыв (необязательно)", { exact: true })
        .fill("Спасибо за работу");
      await button(page, "Отправить оценку").click();
      await visible(page, `Ваша оценка: ${score} из 5`);
      assert.equal(
        await page
          .getByRole("form", { name: "Оценить вторую сторону" })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await second.goto(path);
    await visible(second, "Завершено");
    assert.equal(
      await second
        .getByRole("form", { name: "Оценить вторую сторону" })
        .count(),
      0,
    );
    await history(customer, false, title);
    await history(worker, true, title);
    if (await button(worker, "Открыть меню").isVisible()) {
      await button(worker, "Открыть меню").click();
    }
    await button(worker, "Выйти").click();
    await worker.goto("/my-gigs");
    await worker.waitForURL("**/login");
    await worker
      .getByLabel("Email", { exact: true })
      .fill(credentials.worker.email);
    await worker.getByLabel("Пароль", { exact: true }).fill("wrong-password");
    await button(worker, "Войти").click();
    await worker.getByRole("alert").waitFor();
    await worker.goto("/login");
    await login(worker, credentials.worker);
    await history(worker, true, title);

    const create = async (title) =>
      (
        await post(
          customer,
          "/gigs",
          {
            title,
            description: "Работа для проверки",
            requirements: "",
            city: "Москва",
            address: "Мира, 1",
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            endsAt: new Date(Date.now() + 90000000).toISOString(),
            amountKopecks: 10000,
          },
          201,
        )
      ).json();
    const cancelled = await create("Задание для отмены");
    const cancelPath = `/gigs/${cancelled.id}`;
    const withdrawn = await (
      await post(worker, `${cancelPath}/applications`, {}, 201)
    ).json();
    await post(worker, `${cancelPath}/applications/${withdrawn.id}/withdraw`);
    await post(worker, `${cancelPath}/applications`, {}, 409);
    await post(second, `${cancelPath}/applications`, {}, 201);
    await customer.goto(cancelPath);
    await button(customer, "Отменить задание").click();
    await visible(customer, "Отменено");
    await post(second, `${cancelPath}/applications`, {}, 409);
    const race = await create("Конкурентный выбор");
    const racePath = `/gigs/${race.id}`;
    const firstApp = await (
      await post(worker, `${racePath}/applications`, {}, 201)
    ).json();
    const secondApp = await (
      await post(second, `${racePath}/applications`, {}, 201)
    ).json();
    const results = await Promise.all(
      [firstApp, secondApp].map((app) =>
        customer.request.post(
          `/api/v1${racePath}/applications/${app.id}/select`,
          { headers: { Origin: baseURL } },
        ),
      ),
    );
    assert.deepEqual(results.map((r) => r.status()).sort(), [200, 409]);
    const applications = await (
      await customer.request.get(`/api/v1${racePath}/applications`)
    ).json();
    assert.deepEqual(applications.items.map((a) => a.status).sort(), [
      "rejected",
      "selected",
    ]);
    const completed = await (
      await customer.request.get(`/api/v1${path}`)
    ).json();
    writeFileSync(
      "/state/result.json",
      JSON.stringify({
        ...credentials,
        title,
        gigId,
        submittedAt: completed.submittedAt,
        completedAt: completed.completedAt,
      }),
      { mode: 0o600 },
    );
    console.log(
      "PASS: registration, publication, application, selection, completion, history, cancellation, rights, conflicts and two-worker race.",
    );
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
}
