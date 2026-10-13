// Static model of the single data: module loaded by tests/pi-contrats/extensions-epreuve.ts (témoin
// `temoins`, voie aveugle « import data: »), for the S4 TypeScript profile only. The specifier is the
// exact literal of the source, never a pattern; its module text defines `export default 41`.
// Nothing is loaded at run time: Node evaluates the data: URL itself, unchanged.
declare module "data:text/javascript,export default 41" {
  const valeur: number;
  export default valeur;
}
