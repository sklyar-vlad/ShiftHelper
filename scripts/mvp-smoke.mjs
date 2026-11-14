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
    hasTouch: mobile,
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
      assert.equal(gig.amountKopecks, 200099);
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
    for (const [page, contact] of [
      [customer, "@smoke-customer"],
      [worker, "@smoke-worker"],
    ]) {
      await page.goto("/profile");
      await button(page, "Редактировать профиль").click();
      await page
        .getByLabel("Как со мной связаться", { exact: true })
        .fill(contact);
      await button(page, "Сохранить").click();
      await visible(page, "Профиль сохранён.");
    }
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
    const cityField = customer.getByRole("combobox", {
      name: "Город",
      exact: true,
    });
    await cityField.fill("Киров");
    await customer
      .getByRole("option", { name: "Киров Калужская область", exact: true })
      .waitFor();
    await customer.screenshot({ path: "/state/city-desktop.png" });
    await cityField.press("ArrowDown");
    await cityField.press("Enter");
    assert.equal(await cityField.inputValue(), "Киров, Калужская область");
    await button(customer, "Опубликовать").click();
    await customer.waitForURL(/\/gigs\/[0-9a-f-]+$/);
    const gigId = customer.url().split("/").at(-1);
    const path = `/gigs/${gigId}`;
    await post(worker, "/gigs", {}, 403);
    await post(foreign, `${path}/cancel`, undefined, 403);
    await worker.goto("/catalog");
    await worker.getByLabel("Название задания", { exact: true }).fill(title);
    const filterCity = worker.getByRole("combobox", {
      name: "Город",
      exact: true,
    });
    await filterCity.fill("Киров");
    const option = worker.getByRole("option", {
      name: "Киров Калужская область",
      exact: true,
    });
    await worker.screenshot({ path: "/state/city-mobile.png" });
    await option.tap();
    assert.equal(await filterCity.inputValue(), "Киров, Калужская область");
    await button(worker, "Найти").click();
    await worker.waitForURL(
      (url) => url.searchParams.get("city") === "Киров, Калужская область",
    );
    await link(worker, title).click();
    await link(worker, "← К подработкам").click();
    assert.equal(
      new URL(worker.url()).searchParams.get("city"),
      "Киров, Калужская область",
    );
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
    await button(customer, "Изменить условия").click();
    await customer
      .getByLabel("Описание", { exact: true })
      .fill("Обновлённые условия переноски коробок");
    await button(customer, "Сохранить условия").click();
    await customer
      .getByText("Кандидат ещё не подтвердил новые условия.", { exact: true })
      .first()
      .waitFor();
    for (const page of [worker, second]) {
      await page.goto(path);
      await button(page, "Подтвердить новые условия").click();
      await button(page, "Подтвердить новые условия").waitFor({
        state: "hidden",
      });
    }
    await customer.reload();
    await customer
      .locator(".application-card")
      .filter({ hasText: "Первый исполнитель" })
      .getByRole("button", { name: "Выбрать исполнителя", exact: true })
      .click();
    await visible(customer, "В работе");
    assert.equal((await guest.request.get(`/api/v1${path}`)).status(), 404);
    assert.equal((await foreign.request.get(`/api/v1${path}`)).status(), 404);
    for (const [page, contact] of [
      [customer, "@smoke-worker"],
      [worker, "@smoke-customer"],
    ]) {
      await page.goto(path);
      await visible(page, contact);
      assert.equal(
        (await (await page.request.get(`/api/v1${path}`)).json())
          .counterpartyContact,
        contact,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    assert.equal(
      (await (await second.request.get(`/api/v1${path}`)).json())
        .counterpartyContact,
      undefined,
    );
    for (const action of ["reject", "withdraw", "accept"]) {
      await customer.goto(path);
      await button(customer, "Изменить условия").click();
      await customer
        .getByLabel("Сумма за всё задание, ₽", { exact: true })
        .fill("2000,99");
      await button(customer, "Предложить изменения").click();
      await visible(customer, "Предложены новые условия");
      await worker.goto("/my-gigs?view=work");
      await worker
        .getByText(
          "Ожидается решение по изменению условий. Откройте задание.",
          { exact: true },
        )
        .waitFor();
      await worker.goto(path);
      await visible(worker, "Предложены новые условия");
      if (action === "reject") {
        await worker
          .getByRole("heading", {
            name: "Предложены новые условия",
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await worker.screenshot({
          path: "/state/terms-mobile.png",
          fullPage: true,
        });
        await customer
          .getByRole("heading", {
            name: "Предложены новые условия",
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await customer.screenshot({
          path: "/state/terms-desktop.png",
          fullPage: true,
        });
      }
      const proposed = await (
        await customer.request.get(`/api/v1${path}`)
      ).json();
      assert.equal(proposed.amountKopecks, 150050);
      assert.equal(proposed.pendingChange.terms.amountKopecks, 200099);
      assert.equal(
        (await (await second.request.get(`/api/v1${path}`)).json())
          .pendingChange,
        undefined,
      );
      if (action === "withdraw")
        await button(customer, "Отозвать предложение").click();
      else
        await button(
          worker,
          action === "accept" ? "Согласиться" : "Отказаться",
        ).click();
      const activePage = action === "withdraw" ? customer : worker;
      await activePage
        .getByRole("heading", { name: "Предложены новые условия", exact: true })
        .waitFor({ state: "hidden" });
      await post(
        worker,
        `${path}/changes/${proposed.pendingChange.id}/accept`,
        undefined,
        409,
      );
      assert.equal(
        await worker.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await customer.goto(path);
    await button(customer, "Изменить условия").click();
    await customer
      .getByLabel("Описание", { exact: true })
      .fill("Предложение, которое истечёт при сдаче");
    await button(customer, "Предложить изменения").click();
    await visible(customer, "Предложены новые условия");
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
      const rating = page.getByRole("group", { name: "Оценка", exact: true });
      const radios = rating.getByRole("radio");
      await radios.nth(4).check();
      await rating.locator("label").nth(1).hover();
      assert.deepEqual(
        await rating
          .locator('span[aria-hidden="true"]')
          .evaluateAll((stars) =>
            stars.map((star) => getComputedStyle(star).color),
          ),
        [
          "rgb(0, 0, 0)",
          "rgb(0, 0, 0)",
          ...Array(3).fill("rgb(103, 113, 124)"),
        ],
      );
      assert.equal(await radios.nth(4).isChecked(), true);
      await page.getByRole("heading", { name: "Оценки за работу" }).hover();
      assert.equal(await rating.locator("label.is-filled").count(), 5);
      await radios.nth(4).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await radios.nth(0).isChecked(), true);
      await page
        .getByRole("radio", { name: new RegExp(`^${score} из 5 —`) })
        .check();
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
    for (const endpoint of ["login", "register"]) {
      let limited = false;
      for (let attempt = 0; attempt < 61; attempt++) {
        const response = await customer.request.post(
          `/api/v1/auth/${endpoint}`,
          {
            headers: {
              Origin: baseURL,
              "X-Forwarded-For": `203.0.113.${attempt + 1}`,
              "X-Real-IP": `203.0.113.${attempt + 1}`,
            },
            data: {},
          },
        );
        if (response.status() === 429) {
          assert.equal((await response.json()).error.code, "RATE_LIMITED");
          assert.ok(Number(response.headers()["retry-after"]) > 0);
          limited = true;
          break;
        }
        assert.equal(response.status(), 400);
      }
      assert.ok(
        limited,
        `${endpoint} limit cannot be bypassed with forwarded headers`,
      );
    }
    for (const page of [customer, worker]) {
      await post(page, "/auth/logout", undefined, 204);
      await page.goto("/login");
      await page
        .getByLabel("Email", { exact: true })
        .fill(credentials.customer.email);
      await page
        .getByLabel("Пароль", { exact: true })
        .fill(credentials.customer.password);
      await button(page, "Войти").click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Слишком много попыток" })
        .waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        credentials.customer.email,
      );
      assert.equal(
        await page.getByLabel("Пароль", { exact: true }).inputValue(),
        "",
      );
      assert.equal(await button(page, "Войти").isEnabled(), true);
    }
    console.log(
      "PASS: MVP flow, concurrent selection and auth limits through Traefik with forged forwarding headers.",
    );
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
}
