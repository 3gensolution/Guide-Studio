# Home Manager module for GuideStudio
# Usage in flake-based Home Manager config:
#
#   inputs.guidestudio.url = "github:guidestudio/guide-studio";
#
#   { inputs, ... }: {
#     imports = [ inputs.guidestudio.homeManagerModules.default ];
#     programs.guidestudio.enable = true;
#   }
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.guidestudio;
in
{
  options.programs.guidestudio = {
    enable = lib.mkEnableOption "GuideStudio screen recorder";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.guidestudio;
      defaultText = lib.literalExpression "inputs.guidestudio.packages.\${pkgs.stdenv.hostPlatform.system}.guidestudio";
      description = "The GuideStudio package to use.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
