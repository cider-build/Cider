export function readConfig() {
  return {
    apiUrl: process.env.CIDER_API_URL || "http://localhost:8000",
  };
}
