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
  limit: "3",
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
    if (
      request.method !== "GET" ||
      pathname !== "/v1/geocode/search" ||
      request.headers.cookie ||
      request.headers.authorization ||
      [...searchParams].length !== 6 ||
      Object.keys(rest).length !== Object.keys(expectedParams).length ||
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
            datasource: { attribution: "© OpenStreetMap contributors" },
          },
        ]
      : [];
    setTimeout(() => {
      if (text === `Сбой, 1, ${cities}`) {
        response.writeHead(503).end();
      } else if (point || text === `Ненайденная, 1, ${cities}`) {
        response.writeHead(200, headers).end(JSON.stringify({ results }));
      } else {
        response.writeHead(400).end();
      }
    }, 350);
  },
).listen(443);
