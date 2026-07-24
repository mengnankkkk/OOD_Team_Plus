export interface IdempotencyRecord {
  ownerKey: string;
  routeCode: string;
  idempotencyKey: string;
  responseJson: string;
  createdAt: string;
}

export async function checkIdempotency(
  _ownerKey: string,
  _routeCode: string,
  _idempotencyKey: string,
): Promise<IdempotencyRecord | null> {
  return null;
}

export async function saveIdempotency(record: IdempotencyRecord): Promise<void> {
  void record;
  // TODO: persist idempotency response.
}
