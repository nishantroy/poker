import { useEffect } from "react";
import { useAuth } from "./lib/auth";
import { navigate, usePath } from "./lib/router";
import { LoginPage } from "./pages/Login";
import { LobbyPage } from "./pages/Lobby";
import { TablePage } from "./pages/Table";
import { ProfilePage } from "./pages/Profile";

export function App() {
  const { user, loading } = useAuth();
  const path = usePath();

  const tableMatch = path.match(/^\/t\/([A-Za-z0-9]+)\/?$/);
  const needsAuth = path !== "/login";

  useEffect(() => {
    if (loading) return;
    if (!user && needsAuth) {
      const next = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
      navigate(`/login${next}`, true);
    } else if (user && path === "/login") {
      const next = new URLSearchParams(location.search).get("next");
      navigate(next && next.startsWith("/") ? next : "/", true);
    }
  }, [user, loading, path, needsAuth]);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-brand border-t-transparent animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (tableMatch) return <TablePage code={tableMatch[1]!.toUpperCase()} />;
  if (path === "/profile") return <ProfilePage />;
  return <LobbyPage />;
}
