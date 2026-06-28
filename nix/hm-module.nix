# Home Manager module for Guide Studio
# Usage in flake-based Home Manager config:
#
#   inputs.guide-studio.url = "github:guidestudio/guide-studio";
#
#   { inputs, ... }: {
#     imports = [ inputs.guide-studio.homeManagerModules.default ];
#     programs.guide-studio.enable = true;
#   }
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.guide-studio;
in
{
  options.programs.guide-studio = {
    enable = lib.mkEnableOption "Guide Studio screen recorder";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.guide-studio;
      defaultText = lib.literalExpression "inputs.guide-studio.packages.\${pkgs.stdenv.hostPlatform.system}.guide-studio";
      description = "The Guide Studio package to use.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
