import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const cities = "Киров, Калужская область";
const places = new Map([
  [`Мира, 1, ${cities}`, [54.08, 34.31]],
  [`Мира, 2, ${cities}`, [54.09, 34.32]],
  [`Устаревшая, 1, ${cities}`, [54.1, 34.33]],
]);
const expectedParams = {
  apiKey: "smoke-geocoder-key",
  filter: "countrycode:ru",
  format: "json",
  lang: "ru",
};

createServer(
  {
    cert: readFileSync("/tls/tls.crt"),
    key: readFileSync("/tls/tls.key"),
  },
  (request, response) => {
    const { pathname, searchParams } = new URL(
      request.url,
      "https://api.geoapify.com",
    );
    const params = Object.fromEntries(searchParams);
    const { text, ...rest } = params;
    const autocomplete = pathname === "/v1/geocode/autocomplete";
    if (
      request.method !== "GET" ||
      (!autocomplete && pathname !== "/v1/geocode/search") ||
      request.headers.cookie ||
      request.headers.authorization ||
      [...searchParams].length !== 6 ||
      rest.limit !== (autocomplete ? "7" : "3") ||
      !Object.entries(expectedParams).every(
        ([key, value]) => rest[key] === value,
      )
    ) {
      response.writeHead(400).end();
      return;
    }

    const point = places.get(text);
    const headers = { "Content-Type": "application/json" };
    const results = point
      ? [
          {
            formatted: text,
            lat: point[0],
            lon: point[1],
            result_type: "building",
            country_code: "ru",
            city: "Киров",
            state: "Калужская область",
            datasource: { attribution: "© OpenStreetMap contributors" },
          },
        ]
      : [];
    setTimeout(() => {
      if (autocomplete) {
        const house = {
          formatted: `Мира, 1, ${cities}`,
          address_line1: "Мира, 1",
          result_type: "building",
          country_code: "ru",
          city: "Киров",
          state: "Калужская область",
          housenumber: "1",
          lat: 54.08,
          lon: 34.31,
          datasource: { attribution: "© OpenStreetMap contributors" },
        };
        let suggestions = [];
        if (text === `Мир, ${cities}`)
          suggestions = [
            { ...house, address_line1: "Мира", result_type: "street" },
          ];
        if (text === `Мира 1, ${cities}`)
          suggestions = [
            {
              ...house,
              state: "Кировская область",
              formatted: "Мира, 1, Кировская область",
              lat: 58.6,
              lon: 49.7,
            },
            house,
          ];
        response
          .writeHead(200, headers)
          .end(JSON.stringify({ results: suggestions }));
      } else if (text === `Сбой, 1, ${cities}`) {
        response.writeHead(503).end();
      } else if (text === `Лимит, 1, ${cities}`) {
        response.writeHead(429, { "Retry-After": "3" }).end();
      } else if (point || text === `Ненайденная, 1, ${cities}`) {
        response.writeHead(200, headers).end(JSON.stringify({ results }));
      } else {
        response.writeHead(400).end();
      }
    }, 350);
  },
).listen(443);
