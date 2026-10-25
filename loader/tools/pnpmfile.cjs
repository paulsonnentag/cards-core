// pnpm resolves and fetches package dependencies, whose specifier is an automerge: url, from the repo. Meant as
// pnpm's globalPnpmfile, so it serves every project on the machine
const install = () => import("./install.ts");
const isPackage = (specifier) =>
  typeof specifier === "string" && specifier.startsWith("automerge:");

module.exports = {
  resolvers: [
    {
      canResolve: ({ bareSpecifier }) => isPackage(bareSpecifier),
      resolve: async ({ alias, bareSpecifier }) =>
        (await install()).resolve(alias, bareSpecifier),
      shouldRefreshResolution: async (_, { resolution }) =>
        resolution.type === "custom:automerge" &&
        (await install()).headsMoved(resolution),
    },
  ],
  fetchers: [
    {
      canFetch: (_, resolution) => resolution.type === "custom:automerge",
      // pnpm 12 only takes files it fetched itself, so hand it a directory
      fetch: async (_, resolution) => ({
        delegate: {
          type: "directory",
          directory: await (await install()).fetchFiles(resolution),
        },
      }),
    },
  ],
};
