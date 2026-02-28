import { createHealthServer } from "./health.js";

const PORT = Number(process.env.PORT ?? 3000);

createHealthServer(PORT);
console.log(`Health server listening on port ${PORT}`);
