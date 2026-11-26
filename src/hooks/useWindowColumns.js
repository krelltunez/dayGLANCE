import { useEffect, useState } from 'react';
import { windowColumns } from '../utils/desktopColumns.js';

const read = () => windowColumns(typeof window !== 'undefined' ? window.innerWidth : 0);

// The column counts the window allows with the side panel open and with it
// hidden (utils/desktopColumns.js). The state only changes when a count does,
// so dragging a window's edge does not re-render the app on every pixel.
export default function useWindowColumns() {
  const [columns, setColumns] = useState(read);
  useEffect(() => {
    const update = () => setColumns((prev) => {
      const next = read();
      return prev.open === next.open && prev.full === next.full ? prev : next;
    });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return columns;
}
