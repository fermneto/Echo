/**
 * Campos das contas da pessoa (cadastro e ficha). O Slack vem da lista da workspace ligada quando o painel tem
 * o bot; sem ela, o RH cola o ID do membro. Campo vazio = sem conta naquela plataforma.
 */
export type AccountValues = { slack?: string; github?: string; linear?: string };

export function AccountFields({ slackMembers, initial = {}, className = "onboard__field" }: { slackMembers: readonly { id: string; name: string }[] | null; initial?: AccountValues; className?: string }) {
  const known = !initial.slack || slackMembers?.some((m) => m.id === initial.slack);
  return (
    <>
      <label className={className}>
        <span className="field-row__k">Conta do Slack</span>
        {slackMembers && known ? (
          <select className="field" name="conta_slack" defaultValue={initial.slack ?? ""}>
            <option value="">Sem Slack por enquanto (fica só no painel)</option>
            {slackMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <input className="field mono" name="conta_slack" defaultValue={initial.slack ?? ""} placeholder="ID do membro, ex.: U07ABC123" autoComplete="off" spellCheck={false} maxLength={21} />
        )}
      </label>
      <label className={className}>
        <span className="field-row__k">Login do GitHub</span>
        <input className="field mono" name="conta_github" defaultValue={initial.github ?? ""} placeholder="ex.: fernando-m" autoComplete="off" spellCheck={false} maxLength={80} />
      </label>
      <label className={className}>
        <span className="field-row__k">ID no Linear</span>
        <input className="field mono" name="conta_linear" defaultValue={initial.linear ?? ""} placeholder="ID do usuário (opcional)" autoComplete="off" spellCheck={false} maxLength={36} />
      </label>
    </>
  );
}
