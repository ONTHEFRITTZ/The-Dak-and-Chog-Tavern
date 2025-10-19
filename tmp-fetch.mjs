const fetch = (await import('node-fetch')).default;
const query = query { paymasters(projectId: \"9b503699-15b1-48c4-a4e7-35d41afd0ee3\") { id name type chainId rpcUrl } };
const res = await fetch('https://api.zerodev.app/v2/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Team-API-Key': '34e14507-89db-41ad-8c76-334712fe3c8f'
  },
  body: JSON.stringify({ query })
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
