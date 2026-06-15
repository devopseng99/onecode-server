# Build Environment — RKE2 Cluster

## Infrastructure
- Worker node: mgplcb05 (192.168.29.147)
- SSH key: ~/.ssh/id_rsa_devops_ssh
- No container registry available — use `podman save | ssh ctr import` pattern
- containerd socket: /run/k3s/containerd/containerd.sock
- Image namespace: k8s.io

## Critical Rules
1. ALWAYS `export TMPDIR=/var/lib/containers/tmp` before podman build
2. ALWAYS use `--network=host` for podman build
3. NEVER use `podman push` — registry is offline
4. ALWAYS set `imagePullPolicy: Never` in Helm values
5. ALWAYS set `nodeSelector: kubernetes.io/hostname: mgplcb05`
6. All replica counts MUST be 1 (memory constrained)
7. Read .claude/skills/ for detailed deployment patterns
8. ALWAYS add `dnsConfig: options: [{name: ndots, value: "2"}]` to every pod spec — host resolv.conf has `search one.one.one.one` which breaks external DNS resolution without this

## Deploy Pattern
```bash
podman build --network=host -t APP:latest .
podman save APP:latest | ssh -i ~/.ssh/id_rsa_devops_ssh 192.168.29.147 \
  "sudo /var/lib/rancher/rke2/bin/ctr --address /run/k3s/containerd/containerd.sock -n k8s.io images import -"
helm upgrade --install APP helm/APP/ -n NAMESPACE --create-namespace \
  --set image.pullPolicy=Never --set nodeSelector."kubernetes\.io/hostname"=mgplcb05
```
