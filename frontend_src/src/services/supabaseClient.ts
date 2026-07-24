// Loose-typed re-export of the Supabase client for service layer use.
// The generated Database types are strict but do not include our tables yet;
// services rely on runtime column mapping through hand-rolled row mappers instead.
import { supabase as typedClient } from "@/integrations/supabase/client";

export const sb = typedClient as unknown as {
  from: (table: string) => any;
  auth: typeof typedClient.auth;
  functions: typeof typedClient.functions;
  channel: typeof typedClient.channel;
  removeChannel: typeof typedClient.removeChannel;
};
