import Link from "next/link";
import { PERSONAS } from "@/lib/demo/personas";
import { requireAccess } from "@/lib/session";
import { localTime } from "@/lib/time";
import { StatusChip } from "@/components/Status";
import { PixelAvatar } from "@/components/PixelAvatar";

export const metadata = { title: "Equipe · Echo" };

export default async function EquipePage() {
  await requireAccess("equipe");
  return (
    <>
      <h1 className="app-title">Equipe</h1>
      <p className="lead">{PERSONAS.length} pessoas em 3 fusos. Abra a ficha para ver a disponibilidade e perguntar ao gêmeo.</p>
      <div className="module table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="label-caps">Pessoa</th>
              <th className="label-caps">Função</th>
              <th className="label-caps">Cidade</th>
              <th className="label-caps">Hora local</th>
              <th className="label-caps">Estado</th>
            </tr>
          </thead>
          <tbody>
            {PERSONAS.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/pessoas/${p.id}`} className="table__person">
                    <PixelAvatar persona={p} size={28} />
                    {p.name}
                  </Link>
                </td>
                <td className="muted">{p.title}</td>
                <td className="muted">{p.city}</td>
                <td className="mono num">{localTime(new Date(), p.timezone)}</td>
                <td>
                  <StatusChip persona={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
