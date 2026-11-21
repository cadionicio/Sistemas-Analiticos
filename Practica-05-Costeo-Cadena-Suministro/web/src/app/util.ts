const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const mesCortoTxt = (p: string) => {
  const r = /^(\d{4})-(\d{2})$/.exec(p);
  return r ? `${MES[+r[2] - 1]}-${r[1].slice(2)}` : p;
};
