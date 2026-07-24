let sequence = 0;

export const nowIso = () => new Date().toISOString();

export const nextId = (prefix: string) => {
  sequence += 1;
  return `${prefix}_draft_${Date.now().toString(36)}_${sequence.toString(36)}`;
};
