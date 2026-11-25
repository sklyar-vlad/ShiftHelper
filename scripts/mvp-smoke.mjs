import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  checkAddressSearch,
  checkExpandedMap,
  checkMapNavigation,
  checkMobileMapScroll,
  chooseMapPoint,
  chooseSuggestedPoint,
  compactPoint,
  interceptMaps,
  mapRegion,
  verifyMap,
} from "./smoke-map.mjs";

const baseURL = process.env.SMOKE_BASE_URL;
assert.ok(baseURL, "SMOKE_BASE_URL is required");
const browsers = await Promise.all([chromium.launch(), chromium.launch()]);
const pageErrors = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
const link = (page, name) => page.getByRole("link", { name, exact: true });
const visible = (page, text) => page.getByText(text, { exact: true }).waitFor();

async function session(index, mobile = false, timezoneId = "UTC") {
  const context = await browsers[index].newContext({
    baseURL,
    hasTouch: mobile,
    viewport: { width: mobile ? 375 : 1280, height: 900 },
    timezoneId,
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

async function chooseDay(page, label, value) {
  const [year, month, day] = value.split("-");
  const group = page.getByRole("group", { name: label, exact: true });
  for (const [part, text] of [
    ["год", year],
    ["месяц", month],
    ["день", day],
  ]) {
    const segment = group.getByRole("spinbutton", {
      name: `${part}, ${label}`,
      exact: true,
    });
    await segment.focus();
    await segment.pressSequentially(text);
  }
  await page.keyboard.press("Tab");
  for (const [part, text] of [
    ["год", year],
    ["месяц", month],
    ["день", day],
  ]) {
    const actual = await group
      .getByRole("spinbutton", { name: `${part}, ${label}`, exact: true })
      .getAttribute("aria-valuenow");
    assert.equal(Number(actual), Number(text), `${label}: ${part}`);
  }
}
async function chooseDateTime(page, label, value) {
  const [day, time] = value.split("T");
  await chooseDay(page, label, day);
  await page
    .getByLabel(
      label === "Начало работы" ? "Время начала" : "Время окончания",
      { exact: true },
    )
    .fill(time);
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

async function notificationFeed(page) {
  const response = await page.request.get(
    "/api/v1/me/notifications?pageSize=100",
  );
  assert.equal(response.status(), 200);
  const feed = await response.json();
  assert.equal(feed.nextCursor, null);
  return feed;
}

async function gigNotifications(page, gigId, types) {
  const { items } = await notificationFeed(page);
  const relevant = items.filter((item) => item.gigId === gigId);
  assert.deepEqual(relevant.map((item) => item.type).sort(), [...types].sort());
  return relevant;
}

async function checkDemoReports(page, path, gigTitle, customerName) {
  const writes = [];
  const recordWrite = (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on("request", recordWrite);
  const comment = "Черновик демо-жалобы для smoke";
  try {
    await page.goto(path);
    for (const [label, target] of [
      ["Пожаловаться на задание", `Задание — ${gigTitle}`],
      ["Пожаловаться на пользователя", `Пользователь — ${customerName}`],
    ]) {
      const trigger = button(page, label);
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: label, exact: true });
      await visible(dialog, target);
      await visible(
        dialog,
        "Демо-режим: жалобы пока не отправляются модераторам.",
      );
      await dialog.getByLabel("Причина", { exact: true }).selectOption("other");
      const field = dialog.getByLabel("Комментарий к жалобе (необязательно)", {
        exact: true,
      });
      await field.fill(comment);
      await button(dialog, "Отправить (демо)").click();
      await visible(dialog, "Демо: жалоба не отправлена и не сохранена.");
      await button(dialog, "Закрыть").click();
      await trigger.click();
      assert.equal(await field.inputValue(), "");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(writes, []);
    assert.equal(
      await page.evaluate(
        (text) =>
          [localStorage, sessionStorage].some((storage) =>
            JSON.stringify(storage).includes(text),
          ),
        comment,
      ),
      false,
    );
  } finally {
    page.off("request", recordWrite);
  }
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
      assert.deepEqual(
        await notificationFeed(page),
        state.notifications[isWorker ? "worker" : "customer"],
      );
      await history(page, isWorker, state.title);
      const response = await page.request.get(`/api/v1/gigs/${state.gigId}`);
      assert.equal(response.status(), 200);
      const gig = await response.json();
      assert.equal(gig.status, "completed");
      assert.equal(gig.amountKopecks, 200099);
      assert.equal(gig.category, "moving");
      assert.equal(gig.address, "Мира, 2");
      assert.deepEqual(gig.point, state.point);
      assert.equal(gig.completedAt, state.completedAt);
      assert.equal(gig.submittedAt, state.submittedAt);
      assert.equal(gig.customer.ratingAverage, 4);
      assert.equal(gig.selectedWorker.ratingAverage, 5);
      assert.deepEqual(gig.selectedWorker.specialties, ["electrical"]);
      await page.goto(`/gigs/${state.gigId}`);
      await mapRegion(page)
        .getByText(/Карта не настроена/)
        .waitFor();
      await visible(page, gig.address);
      await page.getByRole("link", { name: "Geoapify", exact: true }).waitFor();
      assert.equal(await mapRegion(page).locator("canvas").count(), 0);
      const own = page.getByRole("article", { name: "Ваш отзыв", exact: true });
      await visible(own, `${isWorker ? 4 : 5} из 5`);
      const other = page.getByRole("article", {
        name: "Отзыв другой стороны",
        exact: true,
      });
      await visible(other, `${isWorker ? 5 : 4} из 5`);
      assert.equal(await other.locator("time").count(), 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `/state/review-cards-${isWorker ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
      assert.equal(
        await page
          .getByRole("form", { name: "Оценить вторую сторону" })
          .count(),
        0,
      );
      await page.goto("/profile");
      await visible(page, `Рейтинг: ${isWorker ? 5 : 4} из 5 · Отзывов: 1`);
      if (isWorker)
        await visible(
          page.getByRole("list", { name: "Специализации", exact: true }),
          "Электрика",
        );
    }
    for (const scope of ["all", "history"]) {
      const list = await (
        await customer.request.get(`/api/v1/me/gigs?scope=${scope}`)
      ).json();
      assert.ok(list.items.every((gig) => gig.id !== state.hiddenGigId));
    }
    const hidden = await (
      await customer.request.get(`/api/v1/gigs/${state.hiddenGigId}`)
    ).json();
    assert.equal(hidden.hiddenFromMyGigs, true);
    const searchWithoutKey = await post(
      customer,
      "/gig-place-search",
      { city: "Киров, Калужская область", address: "Мира, 1" },
      503,
    );
    assert.match((await searchWithoutKey.json()).error.message, /не настроен/);
    await customer.goto("/gigs/new");
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    for (const [label, value] of Object.entries({
      Название: "Задание без карты",
      Описание: "Проверка текстового адреса",
      Город: "Москва",
      Адрес: "Текстовый адрес",
      "Сумма за всё задание, ₽": "1000",
    })) {
      await customer.getByLabel(label, { exact: true }).fill(value);
    }
    await chooseDateTime(customer, "Начало работы", `${tomorrow}T10:00`);
    await button(customer, "На 2 часа").press("Enter");
    await button(customer, "Показать на карте").press("Enter");
    await customer.getByText(/Поиск адреса недоступен/).waitFor();
    await button(customer, "Опубликовать").press("Enter");
    await customer.waitForURL(/\/gigs\/[0-9a-f-]+$/);
    await visible(customer, "Текстовый адрес");
    assert.equal(await mapRegion(customer).count(), 0);
    const textGig = await (
      await customer.request.get(`/api/v1${new URL(customer.url()).pathname}`)
    ).json();
    assert.equal(textGig.address, "Текстовый адрес");
    assert.equal(textGig.point ?? null, null);
    console.log(
      "PASS: work, history and the accepted location survive restart; a text address works without map keys.",
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
      if (page === worker)
        await page
          .getByRole("checkbox", { name: "Электрика", exact: true })
          .check();
      else
        assert.equal(
          await page
            .getByRole("group", { name: "Специализации", exact: true })
            .count(),
          0,
        );
      await button(page, "Сохранить").click();
      await visible(page, "Профиль сохранён.");
      if (page === worker) {
        await page.reload();
        await visible(
          page.getByRole("list", { name: "Специализации", exact: true }),
          "Электрика",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
    }
    await customer.goto("/my-gigs");
    await visible(customer, "Заданий пока нет");
    await worker.goto("/my-gigs");
    await visible(worker, "Откликов пока нет");
    const second = await session(1);
    await register(second, "Второй исполнитель", "worker");
    const foreign = await session(0);
    await register(foreign, "Другой заказчик", "customer");
    await interceptMaps(customer.context(), true);
    for (const page of [worker, second, guest])
      await interceptMaps(page.context());
    const foreignMapCalls = await interceptMaps(foreign.context());

    const title = "Перенести коробки для показа";
    await customer.goto("/gigs/new");
    const scenarioStart = Date.now();
    const date = (offset) =>
      new Date(scenarioStart + offset).toISOString().slice(0, 16);
    for (const [label, value] of Object.entries({
      Название: title,
      Описание: "Помочь перенести коробки",
      Город: "Москва",
      Адрес: "Мира, 1",
      "Начало работы": date(86400000),
      "Сумма за всё задание, ₽": "1500,50",
    }))
      if (label === "Начало работы")
        await chooseDateTime(customer, label, value);
      else await customer.getByLabel(label, { exact: true }).fill(value);
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
    const categoryField = customer.getByLabel("Категория", { exact: true });
    await customer.waitForFunction(
      () => !!document.querySelector('#gig-category option[value="moving"]'),
    );
    await categoryField.focus();
    await categoryField.press("Home");
    for (let step = 0; step < 4; step++) await categoryField.press("ArrowDown");
    await categoryField.press("Tab");
    assert.equal(await categoryField.inputValue(), "moving");
    const calendarTrigger = button(customer, "Открыть календарь Начало работы");
    await calendarTrigger.focus();
    await calendarTrigger.press("Enter");
    await customer
      .getByRole("dialog", { name: "Выбор даты: Начало работы" })
      .waitFor();
    await customer.screenshot({
      path: "/state/date-desktop.png",
      fullPage: true,
    });
    await customer.keyboard.press("Escape");
    await customer.waitForFunction(
      (id) => document.activeElement?.id === id,
      await calendarTrigger.getAttribute("id"),
    );
    const fourHours = button(customer, "На 4 часа");
    await fourHours.click();
    assert.equal(await fourHours.getAttribute("aria-pressed"), "true");
    await checkAddressSearch(customer);
    const placed = await chooseSuggestedPoint(customer);
    await button(customer, "Опубликовать").click();
    await customer.waitForURL(/\/gigs\/[0-9a-f-]+$/);
    const gigId = customer.url().split("/").at(-1);
    const path = `/gigs/${gigId}`;
    const dictionary = await guest.request.get("/api/v1/gig-categories");
    assert.equal(dictionary.status(), 200);
    const categories = await dictionary.json();
    assert.equal(categories.length, 10);
    assert.ok(
      categories.some(
        (item) => item.code === "moving" && item.name === "Переезды и погрузка",
      ),
    );
    const original = await (
      await customer.request.get(`/api/v1${path}`)
    ).json();
    assert.equal(original.category, "moving");
    assert.equal(original.address, "Мира, 1");
    assert.deepEqual(compactPoint(original.point), placed);
    await verifyMap(customer, original.point);
    await checkMapNavigation(guest, path);
    assert.equal(
      Date.parse(original.endsAt) - Date.parse(original.startsAt),
      4 * 3600000,
    );
    const categorized = original;
    await visible(customer, "Переезды и погрузка");
    await customer.screenshot({
      path: "/state/category-desktop.png",
      fullPage: true,
    });
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
    await worker.emulateMedia({ reducedMotion: "reduce" });
    await button(worker, "Фильтры +").click();
    assert.equal(
      await worker
        .locator(".catalog-filter-options")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await worker
      .getByLabel("Категория", { exact: true })
      .selectOption("moving");
    await worker.getByLabel("Оплата от, ₽", { exact: true }).fill("1500,50");
    await worker.getByLabel("Оплата до, ₽", { exact: true }).fill("1500.50");
    await chooseDay(worker, "Начало от", original.startsAt.slice(0, 10));
    await chooseDay(
      worker,
      "Начало до, включительно",
      original.startsAt.slice(0, 10),
    );
    const mobileCalendar = button(worker, "Открыть календарь Начало от");
    await mobileCalendar.click();
    const calendarPanel = worker.locator(".date-picker-popover");
    await calendarPanel.waitFor();
    assert.equal(
      await calendarPanel.evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    const calendarBounds = await calendarPanel.boundingBox();
    assert.ok(
      calendarBounds.x >= 0 && calendarBounds.x + calendarBounds.width <= 375,
    );
    assert.ok(
      calendarBounds.y >= 0 && calendarBounds.y + calendarBounds.height <= 900,
    );
    await worker.screenshot({ path: "/state/date-mobile.png", fullPage: true });
    await worker.keyboard.press("PageDown");
    await worker.keyboard.press("Escape");
    await calendarPanel.waitFor({ state: "hidden" });
    await worker.waitForFunction(
      (id) => document.activeElement?.id === id,
      await mobileCalendar.getAttribute("id"),
    );
    await mobileCalendar.click();
    await worker.mouse.click(4, 150);
    await calendarPanel.waitFor({ state: "hidden" });
    await worker
      .getByLabel("Длительность", { exact: true })
      .selectOption("240");
    await worker
      .getByLabel("Сортировка", { exact: true })
      .selectOption("nearest");
    const filteredResponse = worker.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/v1/gigs" &&
        url.searchParams.get("category") === "moving" &&
        url.searchParams.get("maxDurationMinutes") === "240" &&
        url.searchParams.get("sort") === "nearest"
      );
    });
    await button(worker, "Применить").click();
    const filtered = await filteredResponse;
    assert.equal(filtered.status(), 200);
    assert.ok((await filtered.json()).items.some((item) => item.id === gigId));
    await link(worker, title).waitFor();
    assert.equal(new URL(worker.url()).searchParams.get("category"), "moving");
    assert.equal(
      await worker.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await button(worker, "Фильтры +").click();
    await worker.screenshot({
      path: "/state/catalog-mobile.png",
      fullPage: true,
    });
    await worker.reload();
    await link(worker, title).waitFor();
    assert.equal(
      await worker.getByLabel("Категория", { exact: true }).isVisible(),
      false,
    );
    assert.equal(
      await worker.getByLabel("Оплата от, ₽", { exact: true }).inputValue(),
      "1500,50",
    );
    await worker
      .getByRole("link", {
        name: "Убрать фильтр «Категория: Переезды и погрузка»",
        exact: true,
      })
      .click();
    await worker.waitForURL((url) => !url.searchParams.has("category"));
    assert.equal(new URL(worker.url()).searchParams.get("duration"), "240");
    await worker.goBack();
    await link(worker, title).waitFor();
    await link(worker, title).click();
    await link(worker, "← К подработкам").click();
    assert.equal(
      new URL(worker.url()).searchParams.get("city"),
      "Киров, Калужская область",
    );
    await link(worker, title).click();
    await verifyMap(worker, original.point);
    await visible(
      worker,
      await mapRegion(customer).locator(".place-map-warning").textContent(),
    );
    const mobileMap = await mapRegion(worker)
      .locator(".place-map-frame")
      .boundingBox();
    assert.ok(mobileMap.height >= 360, "mobile map height");
    await checkExpandedMap(worker);
    await checkMobileMapScroll(worker);
    await worker
      .getByLabel("Комментарий (необязательно)", { exact: true })
      .fill("Готов помочь");
    await button(worker, "Откликнуться").click();
    await visible(worker, "Отклик ожидает решения заказчика.");
    await post(worker, `${path}/applications`, {}, 409);
    await post(customer, `${path}/applications`, {}, 403);
    await post(
      second,
      `${path}/applications`,
      { termsVersion: categorized.termsVersion },
      201,
    );
    await customer.goto("/profile");
    const customerBell = button(customer, "Уведомления");
    await customerBell.getByText("2", { exact: true }).waitFor();
    await customerBell.click();
    const customerNotifications = customer.getByRole("dialog", {
      name: "Уведомления",
    });
    const newApplications = customerNotifications.getByRole("link", {
      name: /Новый отклик на задание/,
    });
    await newApplications.first().waitFor();
    assert.equal(await newApplications.count(), 2);
    await newApplications.first().click();
    await customer.waitForURL("**" + path);
    await customerBell.getByText("1", { exact: true }).waitFor();
    await customerBell.click();
    await button(customer, "Отметить всё прочитанным").click();
    await customerNotifications
      .getByText("Не прочитано", { exact: true })
      .waitFor({ state: "hidden" });
    await customer.keyboard.press("Escape");
    assert.equal(await button(guest, "Уведомления").count(), 0);
    await customer.reload();
    let editSearches = 0;
    const trackSearch = (request) => {
      if (
        /\/api\/v1\/gig-place-(search|suggestions)$/.test(
          new URL(request.url()).pathname,
        )
      )
        editSearches++;
    };
    customer.on("request", trackSearch);
    await button(customer, "Изменить условия").click();
    await customer
      .getByLabel("Описание", { exact: true })
      .fill("Обновлённые условия переноски коробок");
    await customer
      .getByLabel("Категория", { exact: true })
      .selectOption("repair");
    await button(customer, "Сохранить условия").click();
    await customer
      .getByText("Кандидат ещё не подтвердил новые условия.", { exact: true })
      .first()
      .waitFor();
    customer.off("request", trackSearch);
    assert.equal(editSearches, 0);
    const edited = await (await customer.request.get(`/api/v1${path}`)).json();
    assert.equal(edited.address, original.address);
    assert.deepEqual(edited.point, original.point);
    await worker.goto("/profile");
    await button(worker, "Редактировать профиль").click();
    const bio = worker.getByLabel("О себе", { exact: true });
    const savedBio = "Описание, сохранённое после повтора";
    await bio.fill(savedBio);
    const profileAPI = "**/api/v1/me";
    const disconnectSave = (route) =>
      route.request().method() === "PATCH"
        ? route.abort("failed")
        : route.continue();
    await worker.route(profileAPI, disconnectSave);
    try {
      await button(worker, "Сохранить").click();
      await visible(worker, "Сервис временно недоступен. Попробуйте ещё раз.");
      assert.equal(await bio.inputValue(), savedBio);
    } finally {
      await worker.unroute(profileAPI, disconnectSave);
    }
    const workerBell = button(worker, "Уведомления");
    await workerBell.getByText("1", { exact: true }).waitFor();
    await workerBell.focus();
    await worker.keyboard.press("Enter");
    const workerNotifications = worker.getByRole("dialog", {
      name: "Уведомления",
    });
    const termsNotification = workerNotifications.getByRole("link", {
      name: /Условия изменились/,
    });
    await termsNotification.waitFor();
    assert.equal(
      await workerNotifications
        .getByText("Новый отклик на задание", { exact: true })
        .count(),
      0,
    );
    assert.ok(
      await worker.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await termsNotification.focus();
    await worker.keyboard.press("Enter");
    const unsaved = worker.getByRole("alertdialog", {
      name: "Останутся несохранённые изменения",
    });
    const stay = button(unsaved, "Остаться");
    await stay.waitFor();
    assert.ok(
      await stay.evaluate((element) => element === document.activeElement),
    );
    await worker.keyboard.press("Enter");
    await unsaved.waitFor({ state: "hidden" });
    assert.equal(new URL(worker.url()).pathname, "/profile");
    assert.equal(await bio.inputValue(), savedBio);
    assert.equal((await notificationFeed(worker)).unreadCount, 1);
    await button(worker, "Сохранить").click();
    await visible(worker, "Профиль сохранён.");
    await button(worker, "Редактировать профиль").click();
    assert.equal(await bio.inputValue(), savedBio);
    await bio.fill("Черновик, который не должен сохраниться");
    await workerBell.click();
    await termsNotification.click();
    await button(unsaved, "Уйти без сохранения").click();
    await worker.waitForURL("**" + path);
    await workerBell
      .getByText("1", { exact: true })
      .waitFor({ state: "hidden" });
    const staleApplication = await (
      await worker.request.get(`/api/v1${path}`)
    ).json();
    assert.equal(
      staleApplication.myApplication.termsVersion,
      original.termsVersion,
    );
    const staleAgreement = await post(
      worker,
      `${path}/applications/${staleApplication.myApplication.id}/confirm-terms`,
      { termsVersion: original.termsVersion },
      409,
    );
    assert.equal((await staleAgreement.json()).error.code, "STATE_CONFLICT");
    for (const page of [worker, second]) {
      await page.goto(path);
      await visible(page, "Ремонт и сборка");
      await button(page, "Подтвердить новые условия").click();
      await button(page, "Подтвердить новые условия").waitFor({
        state: "hidden",
      });
    }
    await customer.reload();
    const applicant = customer
      .locator(".application-card")
      .filter({ hasText: "Первый исполнитель" });
    await visible(
      applicant.getByRole("list", { name: "Специализации", exact: true }),
      "Электрика",
    );
    await applicant
      .getByRole("button", { name: "Выбрать исполнителя", exact: true })
      .click();
    await visible(customer, "В работе");
    await gigNotifications(worker, gigId, [
      "gig_terms_changed",
      "application_selected",
    ]);
    await gigNotifications(second, gigId, [
      "gig_terms_changed",
      "application_rejected",
    ]);
    assert.equal((await guest.request.get(`/api/v1${path}`)).status(), 404);
    assert.equal((await foreign.request.get(`/api/v1${path}`)).status(), 404);
    await foreign.goto(path);
    await visible(foreign, "Задание недоступно");
    assert.equal(await mapRegion(foreign).count(), 0);
    assert.equal(foreignMapCalls(), 0);
    await checkDemoReports(worker, path, title, "Заказчик проверки");
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
    const proposedStart = date(2 * 86400000);
    const proposedEnd = date(2 * 86400000 + 3600000);
    for (const action of ["reject", "withdraw", "accept"]) {
      await customer.goto(path);
      await button(customer, "Изменить условия").click();
      await customer
        .getByLabel("Сумма за всё задание, ₽", { exact: true })
        .fill("2000,99");
      await customer
        .getByLabel("Категория", { exact: true })
        .selectOption(action === "accept" ? "moving" : "delivery");
      await chooseDateTime(customer, "Начало работы", proposedStart);
      await chooseDateTime(customer, "Окончание работы", proposedEnd);
      let newPoint;
      if (action !== "withdraw") {
        const editor = customer.getByRole("form", {
          name: "Изменение условий",
        });
        await editor.getByLabel("Адрес", { exact: true }).fill("Мира, 2");
        await mapRegion(editor).waitFor({ state: "hidden" });
        newPoint = await chooseMapPoint(customer);
      }
      await button(customer, "Предложить изменения").click();
      await Promise.race([
        visible(customer, "Предложены новые условия"),
        customer
          .locator(".field-error")
          .filter({ hasText: /\S/ })
          .first()
          .waitFor()
          .then(async () => {
            throw new Error(
              `Form errors: ${await customer.locator(".field-error").allTextContents()}`,
            );
          }),
      ]);
      await worker.goto("/my-gigs?view=work");
      await worker
        .getByText(
          "Ожидается решение по изменению условий. Откройте задание.",
          { exact: true },
        )
        .waitFor();
      await worker.goto(path);
      await visible(worker, "Предложены новые условия");
      await verifyMap(worker, original.point);
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
      assert.equal(proposed.category, "repair");
      assert.equal(proposed.address, "Мира, 1");
      assert.equal(
        proposed.pendingChange.terms.address,
        newPoint ? "Мира, 2" : "Мира, 1",
      );
      assert.deepEqual(
        proposed.pendingChange.terms.point,
        newPoint ?? original.point,
      );
      assert.equal(
        proposed.pendingChange.terms.category,
        action === "accept" ? "moving" : "delivery",
      );
      await worker
        .getByRole("region", { name: "Условия задания", exact: true })
        .getByText(action === "accept" ? "Переезды и погрузка" : "Доставка", {
          exact: true,
        })
        .waitFor();
      assert.equal(proposed.pendingChange.terms.amountKopecks, 200099);
      assert.equal(
        Date.parse(proposed.startsAt),
        Date.parse(original.startsAt),
      );
      assert.equal(
        Date.parse(proposed.pendingChange.terms.startsAt),
        Date.parse(`${proposedStart}Z`),
      );
      assert.equal(
        Date.parse(proposed.pendingChange.terms.endsAt),
        Date.parse(`${proposedEnd}Z`),
      );
      const proposedText = new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(`${proposedStart}Z`));
      await worker
        .getByRole("region", { name: "Условия задания", exact: true })
        .getByText(proposedText, { exact: true })
        .waitFor();

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
      const currentTerms = await (
        await worker.request.get(`/api/v1${path}`)
      ).json();
      assert.deepEqual(
        currentTerms.point,
        action === "accept" ? newPoint : original.point,
      );
      assert.equal(
        currentTerms.address,
        action === "accept" ? "Мира, 2" : "Мира, 1",
      );
      if (action === "accept") await verifyMap(worker, newPoint);
      assert.equal(
        Date.parse(currentTerms.startsAt),
        action === "accept"
          ? Date.parse(`${proposedStart}Z`)
          : Date.parse(original.startsAt),
      );
      assert.equal(
        Date.parse(currentTerms.endsAt),
        action === "accept"
          ? Date.parse(`${proposedEnd}Z`)
          : Date.parse(original.endsAt),
      );
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
    await gigNotifications(customer, gigId, [
      "application_created",
      "application_created",
      "gig_change_accepted",
      "gig_change_rejected",
      "gig_submitted",
    ]);
    await gigNotifications(worker, gigId, [
      "gig_terms_changed",
      "application_selected",
      "gig_change_proposed",
      "gig_change_proposed",
      "gig_change_proposed",
      "gig_change_proposed",
      "gig_change_withdrawn",
      "gig_completed",
    ]);
    for (const [page, score] of [
      [customer, 5],
      [worker, 4],
    ]) {
      await page.goto(path);
      const rating = page.getByRole("radiogroup", {
        name: "Оценка",
        exact: true,
      });
      assert.equal(await button(page, "Отправить оценку").isDisabled(), true);
      if (score === 5) {
        const first = rating.getByRole("radio", { name: /^1 из 5/ });
        await first.focus();
        await page.keyboard.press("Space");
        for (let n = 1; n < score; n++) await page.keyboard.press("ArrowRight");
      } else
        await page
          .locator("label.star-rating-option")
          .nth(score - 1)
          .tap();
      assert.equal(
        await rating
          .getByRole("radio", { name: new RegExp(`^${score} из 5`) })
          .isChecked(),
        true,
      );
      if (score === 5) await page.keyboard.press("ArrowLeft");
      if (score === 5) {
        assert.equal(
          await rating.getByRole("radio", { name: /^4 из 5/ }).isChecked(),
          true,
        );
        await page.keyboard.press("ArrowRight");
      }

      await page
        .getByLabel("Отзыв (необязательно)", { exact: true })
        .fill("Спасибо за работу");
      await page.screenshot({
        path: `/state/review-${score === 5 ? "desktop" : "mobile"}.png`,
        fullPage: true,
      });
      if (page === worker) {
        const reviewsURL = `**/api/v1${path}/reviews`;
        const failSave = (route) =>
          route.request().method() === "POST"
            ? route.fulfill({
                status: 503,
                json: {
                  error: {
                    code: "INTERNAL_ERROR",
                    message: "Сервис временно недоступен.",
                  },
                },
              })
            : route.continue();
        await page.route(reviewsURL, failSave);
        await button(page, "Отправить оценку").click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Сервис временно недоступен." })
          .waitFor();
        assert.equal(
          await page
            .getByLabel("Отзыв (необязательно)", { exact: true })
            .inputValue(),
          "Спасибо за работу",
        );
        assert.equal(
          await rating.getByRole("radio", { name: /^4 из 5/ }).isChecked(),
          true,
        );
        assert.equal(await page.locator(".review-success").count(), 0);
        await page.unroute(reviewsURL, failSave);
      }
      await button(page, "Отправить оценку").click();
      await visible(
        page.getByRole("article", { name: "Ваш отзыв", exact: true }),
        `${score} из 5`,
      );
      if (page === worker) {
        const confirmation = page.locator(".review-success");
        await confirmation.waitFor();
        assert.equal(
          await confirmation.evaluate(
            (el) => getComputedStyle(el).animationName,
          ),
          "none",
        );
        const duplicate = await post(
          page,
          `${path}/reviews`,
          { score, comment: "Повтор" },
          409,
        );
        assert.equal((await duplicate.json()).error.code, "ALREADY_REVIEWED");
      }
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
    const cancellation = customer.getByRole("form", { name: "Отмена задания" });
    const reason = cancellation.getByLabel("Причина отмены");
    assert.ok(
      await reason.evaluate((element) => element === document.activeElement),
    );
    const viewport = customer.viewportSize();
    await customer.setViewportSize({ ...viewport, width: 375 });
    assert.ok(
      await customer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await reason.selectOption("schedule_changed");
    await cancellation
      .getByLabel("Пояснение (необязательно)")
      .fill("Перенесли переезд");
    await button(customer, "Подтвердить отмену").click();
    await visible(customer, "Отменено");
    await visible(customer, "Перенесли переезд");
    await customer.setViewportSize(viewport);
    for (const [candidate, allowed] of [
      [second, true],
      [worker, false],
    ]) {
      await candidate.goto(cancelPath);
      await visible(candidate, "Отменено");
      assert.equal(
        await candidate.getByText("Перенесли переезд", { exact: true }).count(),
        Number(allowed),
      );
    }
    await post(second, `${cancelPath}/applications`, {}, 409);
    await post(customer, `${cancelPath}/cancel`, { reason: "other" }, 409);
    await post(foreign, `${cancelPath}/cancel`, undefined, 404);
    assert.equal(
      (await foreign.request.get(`/api/v1${cancelPath}`)).status(),
      404,
    );
    await gigNotifications(worker, cancelled.id, []);
    await gigNotifications(foreign, cancelled.id, []);
    const [cancellationNotice] = await gigNotifications(second, cancelled.id, [
      "gig_cancelled",
    ]);
    assert.equal(cancellationNotice.cancellationReason, "schedule_changed");
    assert.equal(
      JSON.stringify(cancellationNotice).includes("Перенесли переезд"),
      false,
    );
    await button(second, "Уведомления").click();
    const cancellationLink = second
      .getByRole("dialog", { name: "Уведомления" })
      .getByRole("link", { name: /Заказчик отменил задание/ });
    await visible(cancellationLink, "Изменились сроки");
    await cancellationLink.click();
    await second.waitForURL("**/my-gigs?view=applications&scope=history");
    await link(second, cancelled.title).waitFor();
    const hidePath = `/me/gigs/${cancelled.id}/hide`;
    await post(second, hidePath, undefined, 403);
    await post(foreign, hidePath, undefined, 404);
    await post(customer, `/me/gigs/${gigId}/hide`, undefined, 409);
    const historyURL = "/api/v1/me/gigs?scope=history&pageSize=1";
    const beforeHide = await (await customer.request.get(historyURL)).json();
    assert.equal(beforeHide.items[0].id, cancelled.id);
    await customer.setViewportSize({ ...viewport, width: 375 });
    await customer.goto("/my-gigs?scope=history");
    const cancelledCard = customer
      .getByRole("article")
      .filter({ has: link(customer, cancelled.title) });
    await cancelledCard
      .getByRole("button", { name: "Убрать из моих заданий" })
      .click();
    await cancelledCard.waitFor({ state: "hidden" });
    assert.ok(
      await customer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await customer.setViewportSize(viewport);
    const afterHide = await (await customer.request.get(historyURL)).json();
    assert.equal(afterHide.total, beforeHide.total - 1);
    assert.ok(afterHide.items.every((gig) => gig.id !== cancelled.id));
    await post(customer, hidePath, undefined, 204);
    for (const scope of ["all", "history", "active"]) {
      const list = await (
        await customer.request.get(`/api/v1/me/gigs?scope=${scope}`)
      ).json();
      assert.ok(list.items.every((gig) => gig.id !== cancelled.id));
    }
    await customer.goto(cancelPath);
    await visible(customer, "Перенесли переезд");
    assert.equal(await button(customer, "Убрать из моих заданий").count(), 0);
    await second.goto(cancelPath);
    await visible(second, "Перенесли переезд");
    assert.equal(await button(second, "Убрать из моих заданий").count(), 0);
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
    for (let n = 1; n <= 21; n++) await create(`Проверка фильтров ${n}`);
    const filters = new URLSearchParams({
      q: "Проверка фильтров",
      category: "other",
      minPay: "100",
      maxPay: "100",
      duration: "120",
      sort: "amount_asc",
    });
    await customer.goto(`/catalog?${filters}`);
    await visible(customer, "Найдено заданий: 21");
    assert.equal(await customer.locator(".gig-card").count(), 20);
    assert.equal(await button(customer, "Фильтры +").isVisible(), false);
    assert.equal(await button(customer, "Применить").isVisible(), false);
    await customer.screenshot({
      path: "/state/catalog-desktop.png",
      fullPage: true,
    });
    await link(customer, "Далее").click();
    await visible(customer, "Страница 2");
    await customer.locator(".gig-card").first().waitFor();
    assert.equal(await customer.locator(".gig-card").count(), 1);
    assert.equal(new URL(customer.url()).searchParams.get("category"), "other");
    await customer.reload();
    await visible(customer, "Страница 2");
    await customer.goBack();
    await visible(customer, "Страница 1");
    const dst = await session(0, false, "America/New_York");
    const request = dst.waitForRequest(
      (req) => new URL(req.url()).pathname === "/api/v1/gigs",
    );
    await dst.goto("/catalog?dateFrom=2027-03-14&dateTo=2027-03-14");
    const bounds = new URL((await request).url()).searchParams;
    assert.equal(bounds.get("startsFrom"), "2027-03-14T05:00:00.000Z");
    assert.equal(bounds.get("startsBefore"), "2027-03-15T04:00:00.000Z");
    let invalidRequests = 0;
    dst.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/v1/gigs") invalidRequests++;
    });
    await dst.goto("/catalog?minPay=10&maxPay=1");
    await dst.getByRole("alert").waitFor();
    await dst.waitForLoadState("networkidle");
    assert.equal(invalidRequests, 0);
    await dst.context().addCookies(await customer.context().cookies());
    const fold = await (
      await post(
        customer,
        "/gigs",
        {
          title: "Проверка перевода часов",
          description: "Работа для проверки",
          requirements: "",
          city: "Москва",
          address: "Адрес",
          startsAt: "2030-11-03T00:30:00-04:00",
          endsAt: "2030-11-03T01:30:00-04:00",
          amountKopecks: 10000,
        },
        201,
      )
    ).json();
    await dst.goto(`/gigs/${fold.id}`);
    await button(dst, "Изменить условия").click();
    assert.equal(
      await button(dst, "Свой период").getAttribute("aria-pressed"),
      "true",
    );
    await button(dst, "На 2 часа").click();
    await button(dst, "Сохранить условия").click();
    await button(dst, "Изменить условия").waitFor();
    const savedFold = await (
      await dst.request.get(`/api/v1/gigs/${fold.id}`)
    ).json();
    assert.equal(
      Date.parse(savedFold.endsAt) - Date.parse(savedFold.startsAt),
      7200000,
    );
    assert.equal(savedFold.endsAt, "2030-11-03T06:30:00Z");
    await dst.close();
    const completed = await (
      await customer.request.get(`/api/v1${path}`)
    ).json();
    await worker.goto("/profile");
    await button(worker, "Редактировать профиль").click();
    await bio.fill("Несохранённое описание перед выходом");
    await button(worker, "Открыть меню").click();
    await button(worker, "Выйти").click();
    await worker.waitForURL("**/");
    await button(worker, "Уведомления").waitFor({ state: "hidden" });
    assert.equal(
      (await worker.request.get("/api/v1/me/notifications")).status(),
      401,
    );
    await login(worker, credentials.worker);
    await visible(worker, savedBio);
    writeFileSync(
      "/state/result.json",
      JSON.stringify({
        ...credentials,
        title,
        gigId,
        hiddenGigId: cancelled.id,
        point: completed.point,
        submittedAt: completed.submittedAt,
        completedAt: completed.completedAt,
        notifications: {
          customer: await notificationFeed(customer),
          worker: await notificationFeed(worker),
        },
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
