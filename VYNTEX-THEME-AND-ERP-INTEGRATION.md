# VYNTEX integration and day/night appearance

The website has a responsive VYNTEX ERP navigation CTA. The destination defaults to `https://erp.vyntexusa.com` and can be changed using `NEXT_PUBLIC_VYNTEX_ERP_URL` during the **website** build.

Both apps default to a restrained light appearance for visitors without preferences, offer a night-mode toggle, and share the `vyntex_theme` cookie on HTTPS hosts beneath `vyntexusa.com`. The ERP retains its existing workspace theme toggle; a new floating toggle serves its marketing/sign-in routes.

Deployment: upload each ZIP to its corresponding repository. Assign the ERP host `erp.vyntexusa.com` in DNS and hosting dashboard separately. Neither DNS nor cross-app authentication is provisioned by these changes; the site client portal remains distinct. Test links, menus, themes, and auth on a staging domain before launch.
