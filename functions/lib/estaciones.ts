// Enlaces públicos proporcionados por el operador. No implican autorización de API.
import type {Oficina} from "./oficinas";
export const ESTACIONES = {
 sanfernando:{nombre:"San Fernando",id:"7628e209-3267-4fff-bf99-7255e109a9fc"},
 curico:{nombre:"Curicó",id:"81153994-0f99-48c7-8bf8-fc1d7ecc2fc0"},
 rancagua:{nombre:"Rancagua",id:"9c7426d7-3d58-43aa-a839-c406e53be5e9"},
 santiagoSur:{nombre:"Santiago · Terminal Sur",id:"e69c534e-f6ab-40d6-8b2e-82daa155971e"},
 santacruz:{nombre:"Santa Cruz",id:"23b9fd59-ce00-447d-bdd8-6e6f43f8f63a"}
} as const;
const POR_OFICINA:Record<Oficina,readonly (keyof typeof ESTACIONES)[]> = {
 sanfernando:["sanfernando"],curico:["curico"],rancagua:["rancagua"],santiago:["santiagoSur"]
};
// Santa Cruz queda registrada como estación candidata, no como oficina independiente.
export function estacionesOficina(o:Oficina){return POR_OFICINA[o].map(k=>ESTACIONES[k])}
