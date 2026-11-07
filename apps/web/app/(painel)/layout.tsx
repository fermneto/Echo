import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { navFor } from "@/lib/access";
import { currentPersona, demoMode } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { sair } from "../entrar/actions";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const persona = await currentPersona();
  if (!persona) redirect("/entrar");
  const demo = demoMode();

  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <Logo />
          <Nav groups={navFor(persona.role, { demo })} />
          <div className="topbar__me">
            <span className="mono muted">{persona.name.toUpperCase()}</span>
            <form action={sair}>
              <button type="submit" className="link-button label-caps">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
