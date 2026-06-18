# Codegen Templates

OpenAPI Generator templates voor startbare API-applicaties op basis van een
gebundelde OpenAPI-specificatie.

De templates zijn bedoeld voor een design-first workflow: eerst een OAS als
contract, daarna servercode genereren en de echte implementaties koppelen.

## Templates

| Template | Generator | Runtime | Gebruik wanneer |
| --- | --- | --- | --- |
| `nodejs-express-server` | `nodejs-express-server` | Node.js + Express | Je snel een eenvoudige JavaScript serverstub of mockserver wilt. |
| `nestjs-fastify` | `typescript-nestjs-server` | NestJS + Fastify | Je een TypeScript/NestJS basisapp met runtime-validatie, mock mode en problem-details wilt. |
| `go-gin-template` | `go-gin-server` | Go + Gin | Je een compacte Go serverstub wilt die aansluit op de bestaande DON Go-apps. |

## Vereisten

- Node.js 22 of hoger voor de Node/NestJS templates en de `npx` tooling.
- Java 11 of hoger voor `@openapitools/openapi-generator-cli`.
- Go 1.25 of hoger voor de Go-template.
- Een gebundelde OAS zonder externe refs voor de beste generator-output.

## Basisflow

Bundel eerst de OAS. De input mag een URL of lokaal bestand zijn:

```sh
npx @redocly/cli bundle https://api.developer.overheid.nl/tools/v1/openapi.json \
  --output openapi.bundled.json \
  --ext json
```

Valideer de gebundelde OAS bij voorkeur tegen de ADR-regels voordat je code
genereert:

```sh
npx @developer-overheid-nl/don-checker@latest validate \
  --ruleset adr-21 \
  --input openapi.bundled.json
```

Genereer daarna een applicatie met een van de templates hieronder.

## Node.js Express

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g nodejs-express-server \
  -o ./generated-api-express \
  -t ./nodejs-express-server \
  --additional-properties=projectName=generated-api-express
```

Start:

```sh
cd generated-api-express
npm start
```

Mock mode:

```sh
npm run start-mock
```

De Express-template gebruikt `express-openapi-validator`, publiceert de
OpenAPI-documentatie en genereert controllers/services per operatie. De service
stubs zijn de plek waar je businesslogica toevoegt.

## NestJS Fastify

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g typescript-nestjs-server \
  -o ./generated-api-nestjs \
  -t ./nestjs-fastify \
  -c ./nestjs-fastify/generator-config.yaml \
  --skip-validate-spec \
  --additional-properties=npmName=generated-api-nestjs,npmVersion=1.0.0,nestVersion=11.0.0,rxjsVersion=7.8.2,tsVersion=5.9.3,nodeVersion=22.0.0
```

Start:

```sh
cd generated-api-nestjs
npm run init-install
npm run dev
```

Mock mode:

```sh
npm run dev-mock
```

Optionele response-validatie:

```sh
OPENAPI_VALIDATE_RESPONSES=true npm run dev
```

De NestJS-template genereert abstracte API classes en controllers. Koppel echte
implementaties via `ApiModule.forRoot`:

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

Ontbrekende implementaties geven standaard `501 application/problem+json`.

## Go Gin

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g go-gin-server \
  -o ./generated-api-go \
  -t ./go-gin-template \
  -c ./go-gin-template/generator-config.yaml \
  --additional-properties=packageName=api_client,apiPath=pkg/api_client,serverPort=1337 \
  --git-host github.com \
  --git-user-id developer-overheid-nl \
  --git-repo-id generated-api-go
```

Start:

```sh
cd generated-api-go
go mod tidy
go run .
```

De Go-app luistert standaard op poort `1337`. Gebruik `PORT` om dit te
overschrijven:

```sh
PORT=8080 go run .
```

De Go-template genereert interfaces per API-groep en stub controllers. Geef een
eigen implementatie mee aan `NewRouter`:

```go
router := api_client.NewRouter(api_client.ApiHandleFunctions{
	// ToolsAPI: toolsController,
})
```

Ontbrekende implementaties geven standaard `501 application/problem+json`.

## Outputafspraken

De gegenereerde apps publiceren de gebundelde OAS vanuit `api/openapi.yaml`.
De NestJS-template publiceert daarnaast ook `/openapi.json`.

Gebruik de gegenereerde code als startpunt voor een applicatie. Wijzigingen die
voor alle toekomstige applicaties moeten gelden horen in deze template-repo,
niet alleen in een gegenereerde app.

## Template Onderhoud

Werk per wijziging minimaal deze checks af:

1. Genereer een app uit een representatieve OAS.
2. Installeer dependencies in de gegenereerde output.
3. Start of compileer de gegenereerde app.
4. Controleer dat ontbrekende implementaties een problem-details response geven.

Voorbeelden:

```sh
# NestJS
npm run typecheck

# Go
go test ./...
```

OpenAPI Generator kan bij OAS 3.1 nog waarschuwingen geven. Dat is niet per se
een templatefout. Gebruik `--skip-validate-spec` alleen wanneer Redocly en de
DON Checker de OAS accepteren, maar OpenAPI Generator strenger of beperkter is.
