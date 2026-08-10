# Why the functions run in Tokyo

`vercel.json` pins server rendering to **`hnd1`** (Tokyo). That looks wrong at
first glance — every user is in India — so here is the arithmetic.

Measured before the change:

```
X-Vercel-Id: bom1::iad1
```

The request entered at Vercel's Mumbai edge and the function ran in
**Washington DC**. Supabase is in **Tokyo** (`ap-northeast-1`). So each page
went India → Mumbai → DC → Tokyo → DC → Mumbai → India, and every database
query in the page crossed the Pacific twice.

A page issues **many** queries and returns **one** response. That asymmetry is
the whole argument:

| Function region | DB round trips (×10) | User round trip | Total |
| --- | --- | --- | --- |
| `iad1` Washington | 10 × ~200ms = 2000ms | ~250ms | **~2.3s** |
| `sin1` Singapore | 10 × ~70ms = 700ms | ~50ms | ~750ms |
| `hnd1` Tokyo | 10 × ~5ms = 50ms | ~130ms | **~180ms** |

Putting the compute next to the database wins because the ten trips collapse
and only one trip to the user is paid. Moving it closer to users instead
(`bom1`, `sin1`) optimises the single cheap hop and leaves the ten expensive
ones.

## The better answer, when there is time

Both in Mumbai: migrate the Supabase project to `ap-south-1` and set this to
`bom1`. Then the ten DB trips stay at ~5ms *and* the user hop drops to ~20ms.

That is a project migration — restore into a new project, move storage, repoint
every key — not a config change, which is why it is not what this file does.

## Note on plan limits

Vercel's Hobby plan allows one region, which is what this sets. Multiple
regions need Pro. If a deploy rejects `regions`, set it instead in
Project Settings → Functions → Function Region.
