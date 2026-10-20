import { useState } from "react";
import { haceCuanto, useData } from "../api.ts";
import { ActorBadge, EmptyState, Icon, useAction } from "../components.tsx";
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
        <div className="page-actions">
          <label className="check"><input type="checkbox" checked={soloIa} onChange={(e) => setSoloIa(e.target.checked)} /> Solo lo que hizo la IA</label>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await run("exportar_historial", {}, { exito: (x) => `Se exportaron ${x.registros} registros` });
              if (r?.url) location.assign(r.url);
            }}
          >
            <Icon name="download" /> Exportar CSV
          </button>
        </div>
      </div>
      <div className="card table-wrap cq" tabIndex={0} role="region" aria-label="Actividad">
        <table className="table responsive historial">
          <thead>
            <tr><th scope="col">Cuándo</th><th scope="col">Quién</th><th scope="col">Qué pasó</th><th scope="col"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {data?.map((h) => (
              <tr key={h.id}>
                <td className="small muted cuando" style={{ whiteSpace: "nowrap" }}><time dateTime={h.creado_en.replace(" ", "T")} title={h.creado_en}>{haceCuanto(h.creado_en)}</time></td>
                <td className="quien"><ActorBadge tipo={h.actor_tipo} cliente={h.actor_cliente} usuario={h.actor_usuario} /></td>
                <td className="que">
                  {h.deshecho_en ? <del className="muted">{h.resumen}</del> : h.resumen}
                  {h.deshecho_en && <span className="badge" style={{ marginLeft: "0.5rem" }}><Icon name="undo" /> Deshecho</span>}
                </td>
                <td className="r acciones">
                  {h.se_puede_deshacer && (
                    <button className="btn sm" onClick={() => run("deshacer", { historial_id: h.id }, { exito: () => "Se deshizo la acción" })} aria-label={`Deshacer: ${h.resumen}`}>
                      <Icon name="undo" /> Deshacer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.length && <EmptyState>{soloIa ? "La IA todavía no ha hecho cambios." : "Todavía no hay actividad. Cada venta, entrada o cambio aparecerá aquí."}</EmptyState>}
      </div>
    </div>
  );
}
