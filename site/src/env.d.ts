declare module "virtual:cards/packages" {
  const packages: Record<
    string,
    import("@automerge/automerge-repo").AutomergeUrl
  >;
  export default packages;
}
