import { createContext, useContext } from 'react';
export const DayPlannerContext = createContext(null);
export const useDayPlannerCtx = () => useContext(DayPlannerContext);
