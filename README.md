# Backend-Template

Microservice e-commerce backend. Public requests enter through the API gateway at
`http://localhost:3000/api/v1`.

## API contract

The OpenAPI 3.1 contract is committed at [`docs/openapi.json`](docs/openapi.json).
It covers every public gateway route; internal service-to-service endpoints are
excluded deliberately.

```powershell
pnpm openapi:generate # regenerate after an intentional route change
pnpm openapi:check    # fail on undocumented, removed, or stale routes
```

`pnpm test` runs the contract drift check before the workspace tests.

## Marketplace catalog model

The catalog follows the model used by large multi-seller marketplaces:

| Record | Meaning | Shared between sellers |
| --- | --- | --- |
| `catalog_products` | Canonical item identified by GTIN/model | Yes |
| `catalog_variants` | Concrete option combination such as color and size | Yes |
| `products` | Seller offer with seller SKU, condition, price and approval state | No |
| `inventories` | Stock for one seller offer | No |

Multiple sellers therefore attach offers to the same `catalog_variant_id`.
Cart, order and inventory continue to reference the seller-offer `product_id`,
so price, ownership and stock cannot leak between sellers. Use
`GET /api/v1/products/catalog/search` to find grouped variants and
`GET /api/v1/products/catalog/variants/{variantId}/offers` to compare sellers.

## Offline demo data

Start the local demo asset server before seeding so product images remain
available without Internet access:

```powershell
pnpm --filter @ecommerce/web-demo start
node scripts/seed-demo.js
```

The seed targets the same `ecommerce_read` MongoDB database used by the product
and sync services. Override `MONGODB_URI` and `DEMO_ASSET_BASE_URL` when the
read model or demo UI is hosted on another internal machine.
