export function readConfig() {
  return {
    apiUrl: process.env.CIDER_API_URL || "http://100.125.6.13:8000",
  };
}
