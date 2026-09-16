export const restV1OpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Lockhaven Hub",
    version: "1.0.0",
    description:
      "Programmatic access to inventory, enrollment, alerts, sessions, and activity.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
    parameters: {
      limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      cursor: {
        name: "cursor",
        in: "query",
        schema: { type: "string" },
      },
      search: {
        name: "search",
        in: "query",
        schema: { type: "string" },
      },
    },
  },
  paths: {
    "/devices": {
      get: {
        summary: "List devices",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          { $ref: "#/components/parameters/search" },
        ],
        responses: { "200": { description: "Paged device list" } },
      },
    },
    "/devices/{id}": {
      get: {
        summary: "Get a device",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Device" },
          "404": { description: "Not found" },
        },
      },
    },
    "/sites": {
      get: {
        summary: "List sites",
        responses: { "200": { description: "Site list" } },
      },
    },
    "/enrollment-tokens": {
      get: {
        summary: "List enrollment tokens",
        responses: { "200": { description: "Token list" } },
      },
      post: {
        summary: "Create an enrollment token",
        responses: {
          "201": { description: "Token created; secret shown once" },
        },
      },
    },
    "/alerts": {
      get: {
        summary: "List alerts",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
        ],
        responses: { "200": { description: "Paged alert list" } },
      },
    },
    "/alerts/{id}/ack": {
      post: {
        summary: "Acknowledge an alert",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Alert acknowledged" } },
      },
    },
    "/alerts/{id}/resolve": {
      post: {
        summary: "Resolve an alert",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Alert resolved" } },
      },
    },
    "/sessions": {
      get: {
        summary: "List remote sessions",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
        ],
        responses: { "200": { description: "Paged session list" } },
      },
    },
    "/activity": {
      get: {
        summary: "List activity",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
        ],
        responses: { "200": { description: "Paged activity list" } },
      },
    },
    "/assets": {
      get: {
        summary: "List assets",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          { $ref: "#/components/parameters/search" },
        ],
        responses: { "200": { description: "Paged asset list" } },
      },
    },
    "/assets/{id}": {
      get: {
        summary: "Get an asset",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Asset" },
          "404": { description: "Not found" },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI document",
        security: [],
        responses: { "200": { description: "OpenAPI document" } },
      },
    },
  },
} as const
