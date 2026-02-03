import { seedGalaxusOrder } from "../galaxus/seed/seedOrder";

async function main() {
  const order = await seedGalaxusOrder({ lineCount: 120 });
  // eslint-disable-next-line no-console
  console.log(`Seeded Galaxus order ${order.galaxusOrderId} with ${order.lines.length} lines`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to seed Galaxus order:", error);
  process.exit(1);
});
