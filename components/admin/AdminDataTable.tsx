type AdminDataTableProps = {
  title: string;
  description?: string;
  headers: string[];
  rows: React.ReactNode[][];
  emptyState?: React.ReactNode;
};

export function AdminDataTable({
  title,
  description,
  headers,
  rows,
  emptyState,
}: AdminDataTableProps) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#090909] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="border-b border-[#141414] px-[20px] py-[18px]">
        <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
          {title}
        </h2>
        {description ? (
          <p className="mt-[10px] text-[13px] leading-[1.6] text-[#737373]">
            {description}
          </p>
        ) : null}
      </div>

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[#141414] bg-[#0B0B0B]">
                {headers.map((header) => (
                  <th
                    key={header}
                    className="px-[20px] py-[14px] text-left text-[11px] font-medium uppercase tracking-[0.18em] text-[#646464]"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={`row-${rowIndex}`}
                  className="border-b border-[#141414] last:border-b-0"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="px-[20px] py-[16px] align-top text-[14px] text-[#D3D3D3]"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-[20px] py-[20px]">
          {emptyState || (
            <p className="text-[14px] text-[#737373]">
              Nenhum registro disponivel nesta visao.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
