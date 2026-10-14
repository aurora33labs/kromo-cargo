import { useState } from "react";
import { haceCuanto, useData } from "../api.ts";
import { ActorBadge, Icon, useAction } from "../components.tsx";
import { useVersion } from "../version.ts";

export function Historial() {
  const version = useVersion();
  const run = useAction();
  const [soloIa, setSoloIa] = useState(false);
  const { data } = useData<any[]>("historial", { limite: 200, solo_ia: soloIa }, [version]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Historial</h1>
        <div className="spacer" />
        <label className="check"><input type="checkbox" checked={soloIa} onChange={(e) => setSoloIa(e.target.checked)} /> Solo lo que hizo la IA</label>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Cuándo</th><th>Quién</th><th>Qué pasó</th><th /></tr>
          </thead>
          <tbody>
            {data?.map((h) => (
              <tr key={h.id} style={h.deshecho_en ? { opacity: 0.55 } : undefined}>
                <td className="small muted" style={{ whiteSpace: "nowrap" }} title={h.creado_en}>{haceCuanto(h.creado_en)}</td>
                <td><ActorBadge tipo={h.actor_tipo} cliente={h.actor_cliente} usuario={h.actor_usuario} /></td>
                <td>
                  <span style={h.deshecho_en ? { textDecoration: "line-through" } : undefined}>{h.resumen}</span>
                  {h.deshecho_en && <span className="badge" style={{ marginLeft: 8 }}>deshecho</span>}
                </td>
                <td className="r">
                  {h.se_puede_deshacer && (
                    <button className="btn sm" onClick={() => run("deshacer", { historial_id: h.id }, { exito: () => "Se deshizo la acción" })}>
                      <Icon name="undo" /> Deshacer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.length && <div className="empty">Todavía no hay actividad.</div>}
      </div>
    </div>
  );
}
