import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

export default async function ConfigPage() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <span className="text-2xl font-medium">{user.display_name}</span>
    </main>
  );
}
