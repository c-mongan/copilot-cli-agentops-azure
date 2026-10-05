# Firewall Blocking Connectivity

Use when NSG/platform rules allow traffic but the guest OS firewall blocks RDP/SSH.

## Symptoms -> Solutions

| Symptom | OS | Action | Docs |
| --- | --- | --- | --- |
| Windows Firewall blocks RDP | Windows | Enable Remote Desktop firewall group | [Guest firewall] |
| BlockInboundAlways or bad policy | Windows | Reset to `blockinbound,allowoutbound` | [Firewall rule] |
| third-party AV/firewall | Windows | Stop for test, then reconfigure | [Guest firewall] |
| iptables/nftables blocks SSH | Linux | Insert allow rule or remove blocking chain | [SSH overview] |
| firewalld blocks SSH | Linux | Open SSH service in active zone | [SSH overview] |
| UFW blocks SSH | Linux | `ufw allow 22/tcp` or disable temporarily | [SSH overview] |
| no guest access | Any | Use Serial Console or offline repair | [Offline firewall] / [Linux repair] |

## Quick Commands

> Commands use VM agent/extensions. Run [Pre-Flight Safety Checks](cannot-connect-to-vm.md#pre-flight-safety-checks) first.

```bash
# Windows
az vm user reset-remote-desktop --name <vm> -g <rg>
az vm run-command invoke --name <vm> -g <rg> --command-id RunPowerShellScript \
  --scripts "netsh advfirewall firewall set rule group='Remote Desktop' new enable=yes"

# Linux: inspect first, then allow SSH only from an approved client CIDR (<client-cidr>).
# These rules are runtime-only (lost on reboot/reload). Persist only with explicit approval.
az vm run-command invoke --name <vm> -g <rg> --command-id RunShellScript \
  --scripts "iptables -L -n; firewall-cmd --list-all 2>/dev/null; ufw status 2>/dev/null"
az vm run-command invoke --name <vm> -g <rg> --command-id RunShellScript \
  --scripts "iptables -I INPUT -p tcp -s <client-cidr> --dport 22 -j ACCEPT"
az vm run-command invoke --name <vm> -g <rg> --command-id RunShellScript \
  --scripts "firewall-cmd --add-rich-rule='rule family=ipv4 source address=<client-cidr> service name=ssh accept'"
# Rollback: iptables -D INPUT -p tcp -s <client-cidr> --dport 22 -j ACCEPT
#           firewall-cmd --remove-rich-rule='rule family=ipv4 source address=<client-cidr> service name=ssh accept'
# ufw rules always persist; if approved: ufw allow from <client-cidr> to any port 22 proto tcp
#           rollback: ufw delete allow from <client-cidr> to any port 22 proto tcp
```

[Guest firewall]: https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/windows/guest-os-firewall-blocking-inbound-traffic
[Firewall rule]: https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/windows/enable-disable-firewall-rule-guest-os
[Offline firewall]: https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/windows/disable-guest-os-firewall-windows
[SSH overview]: https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/troubleshoot-ssh-connection
[Linux repair]: https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/repair-linux-vm-using-azure-virtual-machine-repair-commands