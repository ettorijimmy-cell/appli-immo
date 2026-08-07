import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { loginRequest } from "./api";
import { authEvents, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from "./auth-events";

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Même mécanisme que apps/desktop/src/renderer/src/auth/AuthContext.tsx :
// token JWT en localStorage, purge automatique sur 401 (token expiré ou
// signé par un secret différent).
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await loginRequest(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    setToken(accessToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
  }, []);

  useEffect(() => {
    authEvents.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => authEvents.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: token !== null, login, logout }),
    [token, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé à l'intérieur d'un AuthProvider");
  }
  return context;
}
