import assert from "node:assert/strict";

const searchAPI = "**/api/v1/gig-place-search";
const mapAPI = "https://maps.geoapify.com/**";
const find = (target, name) =>
  target.getByRole("button", { name, exact: true });
export const mapRegion = (page) =>
  page.getByRole("region", { name: "Карта места", exact: true });

const attribution = "© OpenStreetMap contributors";
const style = {
  version: 8,
  sources: {
    local: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      attribution: `<a href="https://www.openstreetmap.org/copyright">${attribution}</a> · <a href="https://www.geoapify.com/">Geoapify</a>`,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#ecffe0" },
    },
    { id: "places", type: "circle", source: "local" },
  ],
};

function serveStyle(route, status) {
  return route.fulfill({
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
    json: style,
  });
}

export async function interceptMaps(context, initialFailure = false) {
  let calls = 0;
  await context.route(mapAPI, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.pathname, "/v1/styles/osm-bright/style.json");
    assert.deepEqual([...url.searchParams], [["apiKey", "smoke-map-key"]]);
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().authorization, undefined);
    return serveStyle(route, ++calls === 1 && initialFailure ? 503 : 200);
  });
  await context.route("https://api.geoapify.com/**", async (route) => {
    await route.abort();
    assert.fail("Address search must go through the ShiftHelper API");
  });
  return () => calls;
}

export async function checkMapNavigation(page, path) {
  const release = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  const arrived = page.waitForRequest(mapAPI);
  const hold = async (route) => {
    await release.promise;
    try {
      await serveStyle(route, 200);
      delivered.resolve();
    } catch (error) {
      if (error.message.includes("Route is already handled"))
        delivered.resolve();
      else delivered.reject(error);
    }
  };
  await page.route(mapAPI, hold, { times: 1 });
  try {
    await page.goto(path);
    await arrived;
    await page.getByRole("link", { name: "← К подработкам" }).click();
    await page.waitForURL("**/catalog");
    await mapRegion(page).waitFor({ state: "detached" });
    release.resolve();
    await delivered.promise;
  } finally {
    release.resolve();
    await page.unroute(mapAPI, hold);
  }
  assert.equal(await mapRegion(page).count(), 0);
  assert.equal(await page.locator(".maplibregl-marker").count(), 0);
}

export async function checkAddressSearch(page) {
  const address = page.getByLabel("Адрес", { exact: true });
  const show = find(page, "Показать на карте");
  for (const [value, message] of [
    ["Сбой, 1", /Поиск адреса недоступен/],
    ["Ненайденная, 1", /Подходящий адрес не найден/],
  ]) {
    await address.fill(value);
    await show.click();
    await page.getByRole("status").filter({ hasText: message }).waitFor();
  }

  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  const held = async (route) => {
    try {
      const response = await route.fetch({ timeout: 7000 });
      arrived.resolve(response.status());
      await release.promise;
      await route.fulfill({ response });
    } catch (error) {
      arrived.reject(error);
      if (!route.request().failure()) throw error;
    } finally {
      delivered.resolve();
    }
  };
  await page.route(searchAPI, held);
  try {
    await address.fill("Устаревшая, 1");
    await show.click();
    assert.equal(await arrived.promise, 200);
    await address.fill("Другой адрес");
    await address.fill("Устаревшая, 1");
    release.resolve();
    await delivered.promise;
  } finally {
    await page.unroute(searchAPI, held);
    release.resolve();
  }
  assert.equal(await mapRegion(page).count(), 0);
  await address.fill("Мира, 1");
}

export async function chooseMapPoint(
  page,
  address,
  { retry = false, adjust = false } = {},
) {
  const picker = page.getByRole("region", { name: "Место задания на карте" });
  await find(picker, "Показать на карте").click();
  const map = mapRegion(picker);
  if (retry) {
    await map
      .getByRole("status")
      .filter({ hasText: /Не удалось загрузить карту/ })
      .waitFor();
    assert.equal(
      await page.getByLabel("Адрес", { exact: true }).inputValue(),
      address,
    );
    await find(map, "Повторить загрузку").click();
  }
  const marker = map.locator(".maplibregl-marker");
  await marker.waitFor();
  const position = map.getByText(/^Координаты:/);
  if (adjust) {
    const before = await position.textContent();
    await marker.focus();
    await page.keyboard.press("ArrowRight");
    await position.filter({ hasNotText: before }).waitFor();
  }
  const [latitude, longitude] = (await position.textContent())
    .replace("Координаты: ", "")
    .split(", ")
    .map(Number);
  await find(picker, "Подтвердить точку").click();
  return { latitude, longitude, source: "geoapify", attribution };
}

export function compactPoint(point) {
  return {
    ...point,
    latitude: Number(point.latitude.toFixed(6)),
    longitude: Number(point.longitude.toFixed(6)),
  };
}

export async function verifyMap(page, point) {
  const map = mapRegion(page);
  await map.locator(".maplibregl-marker").waitFor();
  const position = `Координаты: ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
  await map.getByText(position, { exact: true }).waitFor();
  await map.getByRole("link", { name: attribution, exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(await find(map, "Поставить метку в центре карты").count(), 0);
}

export async function checkMobileMapScroll(page) {
  const canvas = mapRegion(page).locator(".maplibregl-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const y = Math.floor(bounds.y + bounds.height * 0.7);
  const x = Math.floor(bounds.x + bounds.width / 2);
  const scrollY = await page.evaluate(() => window.scrollY);
  const client = await page.context().newCDPSession(page);
  try {
    const touch = (type, touchPoints) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints });
    await touch("touchStart", [{ x, y }]);
    for (let offset = 20; offset <= 120; offset += 20)
      await touch("touchMove", [{ x, y: y - offset }]);
    await touch("touchEnd", []);
    await page.waitForFunction((before) => window.scrollY > before, scrollY);
  } finally {
    await client.detach();
  }
}
