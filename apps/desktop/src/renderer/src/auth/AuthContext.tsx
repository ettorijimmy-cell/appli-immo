import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { authEvents, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from "./auth-events";
import { fetchPowerSyncCredentials, loginRequest } from "./api";

// Échec non bloquant : une erreur PowerSync (dashboard mal configuré,
// réseau) ne doit jamais empêcher l'utilisateur de se connecter et
// d'utiliser l'app via l'API REST existante — seule la synchronisation
// locale est affectée. Voir docs/backlog.md, chantier PowerSync.
async function synchroniserPowerSync(): Promise<void> {
  try {
    const credentials = await fetchPowerSyncCredentials();
    await window.api.powersync.connect(credentials);
  } catch (error) {
    console.error("Connexion PowerSync échouée (l'application reste utilisable) :", error);
  }
}

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await loginRequest(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    setToken(accessToken);
    void synchroniserPowerSync();
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    void window.api.powersync.disconnect();
  }, []);

  // Session déjà active au démarrage de l'app (token persistant en
  // localStorage) : reconnecte PowerSync sans attendre un nouveau login.
  useEffect(() => {
    if (token) {
      void synchroniserPowerSync();
    }
    // Volontairement au montage seulement — pas à chaque changement de
    // token (le login gère déjà sa propre synchronisation ci-dessus).
  }, []);

  // Un 401 sur n'importe quel appel authentifié (token expiré ou signé par
  // un secret différent — voir docs/error-log.md) purge la session et
  // renvoie vers l'écran de connexion, plutôt que de rester bloqué avec un
  // token mort. Validité du JWT : 1h — scénario garanti en usage normal.
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
