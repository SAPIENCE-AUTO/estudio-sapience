/** 00:12:40: de milisegundos a horas, minutos y segundos. */
export const duracion = (ms: number): string => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

/** 2026-11-12 21:34:05, en la hora de quien lo ve. */
export const fechaYHora = (ms: number): string => {
  const d = new Date(ms);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
};
