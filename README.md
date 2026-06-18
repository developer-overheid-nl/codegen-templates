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
| `java-spring-boot` | `spring` | Java + Spring Boot | Je een Spring Boot basisapp met delegate interfaces, Bean Validation en problem-details wilt. |
| `rust-axum-template` | `rust-axum` | Rust + Axum | Je een Rust crate met Axum-router, API traits en request-validatie wilt. |
| `python-fastapi-template` | `python-fastapi` | Python + FastAPI | Je een Python/FastAPI basisapp met Pydantic-validatie en problem-details wilt. |

Status: de Go-, Java-, Rust- en Python-templates zijn toegevoegd als
basisvarianten, maar zijn nog niet volledig getest in een echte
API-applicatie.

## Vereisten

- Node.js 22 of hoger voor de Node/NestJS templates en de `npx` tooling.
- Java 11 of hoger voor `@openapitools/openapi-generator-cli`.
- Java 17 of hoger voor de Java Spring Boot-template.
- Go 1.25 of hoger voor de Go-template.
- Rust stable en Cargo voor de Rust Axum-template.
- Python 3.10 of hoger voor de Python FastAPI-template.
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

## Java Spring Boot

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g spring \
  -o ./generated-api-java \
  -t ./java-spring-boot \
  -c ./java-spring-boot/generator-config.yaml \
  --additional-properties=groupId=nl.example,artifactId=generated-api-java,artifactVersion=1.0.0,basePackage=nl.example.generated,apiPackage=nl.example.generated.api,modelPackage=nl.example.generated.model
```

Start:

```sh
cd generated-api-java
mvn spring-boot:run
```

De Java-app luistert standaard op poort `1337`. Gebruik `SERVER_PORT` om dit te
overschrijven:

```sh
SERVER_PORT=8080 mvn spring-boot:run
```

De Java-template gebruikt Spring Boot 3 met delegate interfaces. Maak een
Spring service die een gegenereerde `*Delegate` interface implementeert:

```java
@Service
public class ToolsApiService implements ToolsApiDelegate {
    // implement operations here
}
```

De template zet Bean Validation aan voor OAS constraints die OpenAPI Generator
naar Java validatie-annotaties kan mappen. Spring Boot problem-details staat
aan voor frameworkfouten en ontbrekende delegate-implementaties geven standaard
`501 application/problem+json`.

De gegenereerde app publiceert:

- `/openapi.yaml` voor het broncontract waarmee de app is gegenereerd;
- `/openapi.json` voor Springdoc's runtime OpenAPI-document;
- `/swagger-ui.html` wanneer Swagger UI aan staat;
- alle paden uit de OpenAPI-specificatie.

Status: deze Java-template is nog niet volledig getest in een echte
API-applicatie.

## Rust Axum

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g rust-axum \
  -o ./generated-api-rust \
  -t ./rust-axum-template \
  -c ./rust-axum-template/generator-config.yaml \
  --additional-properties=packageName=generated-api-rust,packageVersion=1.0.0
```

Controleer:

```sh
cd generated-api-rust
cargo test
```

De Rust-template genereert een crate met:

- Rust types voor OpenAPI schemas;
- API traits per operatiegroep;
- een Axum-router die requests naar je trait-implementatie dispatcht;
- request-validatie voor path-, query- en bodyparameters waar OpenAPI Generator
  OAS constraints naar Rust validators kan mappen;
- `/openapi.yaml` voor het broncontract waarmee de crate is gegenereerd.

Voor een startbare server maak je zelf een implementatie van de gegenereerde
traits en geef je die mee aan de gegenereerde router:

```rust
#[derive(Clone)]
struct ApiImpl;

impl AsRef<ApiImpl> for ApiImpl {
    fn as_ref(&self) -> &ApiImpl {
        self
    }
}

impl generated_api_rust::apis::ErrorHandler for ApiImpl {}

#[tokio::main]
async fn main() {
    let app = generated_api_rust::server::new(ApiImpl);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:1337").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

Status: deze Rust-template is nog niet getest.

## Python FastAPI

Genereer:

```sh
npx @openapitools/openapi-generator-cli generate \
  -i openapi.bundled.json \
  -g python-fastapi \
  -o ./generated-api-python \
  -t ./python-fastapi-template \
  -c ./python-fastapi-template/generator-config.yaml \
  --additional-properties=packageName=generated_api_python,packageVersion=1.0.0,serverPort=1337
```

Start:

```sh
cd generated-api-python
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=src uvicorn generated_api_python.main:app --host 0.0.0.0 --port 1337
```

De Python-template genereert:

- Pydantic models voor OpenAPI schemas;
- FastAPI routers per API-groep;
- `Base*` classes waar implementaties van kunnen erven;
- request-validatie voor path-, query-, header- en bodyparameters;
- `400 application/problem+json` voor request-validatiefouten;
- `501 application/problem+json` voor ontbrekende implementaties;
- `/openapi.yaml` voor het broncontract waarmee de app is gegenereerd.

Voeg implementaties toe in `src/generated_api_python/impl/` door van de
gegenereerde `Base*` class te erven:

```python
from generated_api_python.apis.example_api_base import BaseExampleApi


class ExampleApiImpl(BaseExampleApi):
    async def get_example(self):
        return {"status": "ok"}
```

Status: deze Python-template is nog niet getest.

## Outputafspraken

De gegenereerde apps publiceren de gebundelde OAS vanuit `api/openapi.yaml`.
De Java-template publiceert het broncontract vanuit
`src/main/resources/static/openapi.yaml`. De Rust-template publiceert het
broncontract vanuit `openapi.yaml`. De Python-template publiceert het
broncontract vanuit `openapi.yaml`. De NestJS-, Java- en Python-templates
publiceren daarnaast ook `/openapi.json`.

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

# Java
mvn test

# Rust
cargo test

# Python
PYTHONPATH=src pytest tests
```

OpenAPI Generator kan bij OAS 3.1 nog waarschuwingen geven. Dat is niet per se
een templatefout. Gebruik `--skip-validate-spec` alleen wanneer Redocly en de
DON Checker de OAS accepteren, maar OpenAPI Generator strenger of beperkter is.
