# OpenAPI Generator API Templates

Templates voor het genereren van startbare API-applicaties vanuit een
OpenAPI-specificatie.

Deze repository bevat:

- de bestaande NestJS Fastify template in de repository-root;
- een Go Gin server template in `go-gin-server-template/`.

## Go Gin Template

De Go-template gebruikt de officiele OpenAPI Generator generator
`go-gin-server` en voegt daar DON-passende defaults aan toe:

- `application/problem+json` voor ontbrekende implementaties;
- `501` voor gegenereerde maar nog niet geimplementeerde operaties;
- `404` en `405` als problem-details;
- standaard `API-Version` response header;
- publicatie van de gebundelde OAS op `/openapi.yaml`;
- `PORT` ondersteuning met default `1337`.

### Go Genereren

Bundel eerst de OAS. De input mag een URL of lokaal bestand zijn:

```sh
npx @redocly/cli bundle https://api.developer.overheid.nl/tools/v1/openapi.json \
  --output tools.openapi.bundled.json \
  --ext json
```

Genereer daarna de applicatie:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i tools.openapi.bundled.json \
  -g go-gin-server \
  -o ./tools-api-go \
  -t ./openapi-generator-nestjs-fastify-template/go-gin-server-template \
  -c ./openapi-generator-nestjs-fastify-template/go-gin-server-template/generator-config.yaml \
  --additional-properties=packageName=api_client,apiPath=pkg/api_client,serverPort=1337 \
  --git-host github.com \
  --git-user-id developer-overheid-nl \
  --git-repo-id tools-api-go
```

Start de applicatie:

```sh
cd tools-api-go
go mod tidy
go run .
```

De gegenereerde app publiceert standaard:

- `/openapi.yaml`
- alle paden uit de OpenAPI-specificatie

Ontbrekende implementaties geven standaard:

```http
501 application/problem+json
```

Voor echte implementaties maak je een type dat de gegenereerde API-interface
implementeert en geef je die mee aan `NewRouter`:

```go
router := api_client.NewRouter(api_client.ApiHandleFunctions{
  // ToolsAPI: toolsController,
})
```

## NestJS Fastify Template

De template gebruikt de officiele OpenAPI Generator generator
`typescript-nestjs-server` en voegt daar een NestJS applicatie met Fastify
adapter, OpenAPI runtime-validatie, mock mode en problem-details
foutafhandeling aan toe.

### Toolchain

- **Bundler/dereferencer:** `@redocly/cli`
- **Generator tool:** `@openapitools/openapi-generator-cli`
- **Generator:** `typescript-nestjs-server`
- **Framework:** NestJS
- **HTTP runtime:** Fastify via `@nestjs/platform-fastify`
- **OpenAPI runtime:** `openapi-backend`
- **Taal:** TypeScript

### NestJS Genereren

Bundel eerst de OAS. De input mag een URL of lokaal bestand zijn:

```sh
npx @redocly/cli bundle https://api.developer.overheid.nl/tools/v1/openapi.json \
  --output tools.openapi.bundled.json \
  --ext json
```

Genereer daarna de applicatie:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i tools.openapi.bundled.json \
  -g typescript-nestjs-server \
  -o ./tools-api \
  -t ./openapi-generator-nestjs-fastify-template \
  -c ./openapi-generator-nestjs-fastify-template/generator-config.yaml \
  --skip-validate-spec \
  --additional-properties=npmName=tools-api,npmVersion=1.0.0,nestVersion=11.0.0,tsVersion=5.9.3
```

Kopieer dezelfde gebundelde OAS naar de runtime-locatie:

```sh
mkdir -p ./tools-api/api
cp tools.openapi.bundled.json ./tools-api/api/openapi.yaml
```

Start de applicatie:

```sh
cd tools-api
npm run init-install
npm run dev
```

De applicatie start standaard op poort `1338`. Gebruik `PORT` om dit te
overschrijven:

```sh
PORT=8080 npm run dev
```

`--skip-validate-spec` is alleen nodig wanneer OpenAPI Generator een OAS
afkeurt die Redocly wel kan bundelen. De huidige Tools OAS bevat bijvoorbeeld
legacy root-level `schemas`, `responses`, `headers` en `securitySchemes`. Voor
een strikt valide OAS kun je deze flag weglaten.

### Output

De output bevat onder andere:

```text
api/openapi.yaml
api/*.ts
controllers/*.controller.ts
models/*.ts
app/api.module.ts
app/api-implementations.ts
app/index.ts
package.json
tsconfig.json
```

De gegenereerde app publiceert standaard:

- `/openapi.yaml`
- `/openapi.json`
- alle paden uit de OpenAPI-specificatie

Ontbrekende implementaties geven standaard:

```http
501 application/problem+json
```

### Runtime

Request-validatie staat standaard aan via `openapi-backend`. De runtime
valideert route, HTTP methode, media type, parameters, body schemas en bekende
JSON schema formats via `ajv-formats`.

Fouten worden teruggegeven als `application/problem+json`. Voorbeelden:

- `400` voor schemafouten, met details in `errors`;
- `405` voor een bestaande route met verkeerde methode, inclusief `Allow`;
- `415` voor een niet toegestaan request media type.

Responses krijgen waar mogelijk metadata uit de OAS: statuscode, content type
en headers zoals `API-Version`.

Mock mode:

```sh
npm run dev-mock
```

In mock mode blijft request-validatie actief. Geldige requests krijgen een
mock-response op basis van OpenAPI examples of response schemas.

Optionele response-validatie:

```sh
OPENAPI_VALIDATE_RESPONSES=true npm run dev
```

Deze mode valideert statuscodes, response bodies en response headers tegen de
OAS. Hij staat niet standaard aan, omdat ontbrekende implementaties als `501`
terugkomen. Als een operation geen `501` response declareert, is dat in
response-validatie mode terecht een contractfout (`502`).

### Implementaties Koppelen

De generator maakt abstracte API classes, bijvoorbeeld `ToolsApi`. Voor echte
implementaties maak je een service die de gegenereerde API class implementeert
en geef je die door aan `ApiModule.forRoot`.

Controllers geven de Fastify reply door aan de implementatie. Daardoor kan een
concrete service zelf extra headers of binary/raw responses zetten, terwijl de
runtime daarna nog steeds OAS metadata kan aanvullen en valideren.

```ts
@Module({
  imports: [
    ApiModule.forRoot({
      apiImplementations: {
        toolsApi: ToolsService,
      },
    }),
  ],
})
export class AppModule {}
```

De default bootstrap staat in `app/index.ts`. Voor een concreet project kun je
die bootstrap aanpassen zodat de juiste implementaties worden geregistreerd.
