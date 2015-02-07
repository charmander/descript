# Descript

Descript is a script-blocking extension for Firefox.


## Usage

Install [descript.xpi][], then set `extensions.descript.whitelist`
in `about:config`. The preference is a space-separated string of URIs; only
their host and scheme parts are used.

Example:

```
https://example.com/ https://github.com/ file:///
```


## Compared to NoScript

Feature                         | Descript | NoScript
------------------------------- |:--------:|:--------:
JavaScript whitelist            | ✓ | ✓
JavaScript blacklist            |   | ✓
Temporary permissions           |   | ✓
Other plugin blocking           |   | ✓
XSS protection                  |   | ✓
Clickjacking protection         |   | ✓
Frame blocking                  |   | ✓
Smart `<noscript>`              |   | ✓
JavaScript link fixing          |   | ✓
`<meta>` redirect blocking      |   | ✓
HTTPS-only whitelist            |   | ✓
Automatic cookie `Secure` flag  |   | ✓
HTTPS rewriting                 |   | ✓
Automatic reloading             |   | ✓
Bootstrapped extension          | ✓ |
Hundreds of lines               | ✓ |
Tens of thousands of lines      |   | ✓


  [descript.xpi]: https://github.com/charmander/descript/releases
