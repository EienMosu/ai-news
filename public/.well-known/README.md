# Digital Asset Links

`assetlinks.json` is what lets the Android app open this site's `/article/...`
links instead of handing them to the browser. Android fetches it over https,
with no redirects and no cookies, and matches the SHA-256 fingerprint of the
certificate the installed app was signed with.

The fingerprint here belongs to the RELEASE keystore at
`~/keystores/theslowwire-release.jks` on the owner's Mac (credentials in
`~/.gradle/gradle.properties`, never in this repo). Two consequences:

- A debug build will NOT open these links, by design — its signature differs.
- Re-signing the app with a different key, including Play App Signing if the
  app is ever published, means adding that key's fingerprint here too. Play
  shows it under Release > Setup > App signing.

Read it back with:
    keytool -list -v -keystore ~/keystores/theslowwire-release.jks -alias theslowwire
