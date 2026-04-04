import { createContext, useContext } from 'react';
export const FeaturesContext = createContext(null);
export const useFeaturesCtx = () => useContext(FeaturesContext);
