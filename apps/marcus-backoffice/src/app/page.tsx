import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { getMarcusSession } from "@/lib/marcus/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getMarcusSession();
  if (session.authenticated) redirect("/overview");
  return <LoginScreen apiAvailable={session.apiAvailable} />;
}
