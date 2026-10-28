FROM swaggerapi/swagger-ui:v5.34.0
ENV SWAGGER_JSON=/spec/openapi.yaml
COPY docs/openapi.yaml /spec/openapi.yaml
COPY swagger/swagger.html /usr/share/nginx/html/swagger.html
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/swagger.html || exit 1
