import { z } from "zod";

export const UserRoleSchema = z.enum(["USER", "ADMIN"]);
export const UserStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export const UsernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/);
export const PasswordSchema = z.string().min(10).max(128);

export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  forcePasswordChange: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SessionContext = {
  user: AuthUser;
  sessionId: string;
};

export class AuthFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
