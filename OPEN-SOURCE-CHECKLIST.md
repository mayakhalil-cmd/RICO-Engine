# Making RICO Engine public (delete this file after)

1. Copy these files over the ones in your RICO-Engine folder (same paths).
2. In `ui`, run `npm run build`, so the About box and Settings show the new license.
3. Teletactile font (`ui/public/fonts/Teletactile.ttf`): it is freeware, not an open source font, so it is
   not covered by the AGPL and its download page does not clearly say it may be shared inside other
   projects. Either email its author for written permission to include it, or take it out of the
   repo and fall back to VT323 (SIL Open Font License) until you have permission.
4. Search the whole repo for "Business Source" and "BSL" and replace anything left.
5. Commit, push, then on GitHub: Settings, General, Danger Zone, Change visibility, Public.
6. Releases you shared before today stay under the Business Source License for the people who have them.
   Everything from now on is AGPL.
