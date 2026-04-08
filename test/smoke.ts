import {
  getCollectionMetadata,
  getDatasetMetadata,
} from "../src/core/datagov-api.js";

async function main(): Promise<void> {
  const collection = await getCollectionMetadata(2);
  console.log(`collection: ${collection.collectionId} — ${collection.name}`);
  console.log(`  managedBy: ${collection.managedBy ?? "?"}`);
  console.log(`  shards:    ${collection.childDatasets.length}`);

  const firstShardId = collection.childDatasets[0];
  if (!firstShardId) {
    throw new Error("collection 2 returned zero child datasets");
  }
  console.log(`  firstShard: ${firstShardId}`);

  const dataset = await getDatasetMetadata(firstShardId);
  console.log(`dataset: ${dataset.datasetId} — ${dataset.name ?? "?"}`);
  console.log(`  format:        ${dataset.format ?? "?"}`);
  console.log(`  size (bytes):  ${dataset.datasetSize ?? "?"}`);
  console.log(`  lastUpdatedAt: ${dataset.lastUpdatedAt ?? "?"}`);
  console.log(`  columnCount:   ${dataset.columnOrder.length}`);

  const labels = Object.entries(dataset.columnLabels).slice(0, 10);
  console.log(`  first 10 columnLabels:`);
  for (const [raw, label] of labels) {
    console.log(`    ${raw} → ${label}`);
  }

  console.log("smoke ok");
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
