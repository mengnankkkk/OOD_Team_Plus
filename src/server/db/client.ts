import { getDbClient as createDbClient } from "./client.runtime";

export function getDbClient() {
  return createDbClient();
}
