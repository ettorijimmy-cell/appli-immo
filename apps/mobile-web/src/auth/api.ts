import { API_BASE_URL } from "../lib/api-config";

export interface LoginResponse {
  accessToken: string;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    throw new Error("Identifiants invalides");
  }

  return (await response.json()) as LoginResponse;
}
