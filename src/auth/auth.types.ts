export interface AuthUser {
  sub: string;
  usuario: string;
  roles: string[];
  permissions: string[];
  exp: number;
}
